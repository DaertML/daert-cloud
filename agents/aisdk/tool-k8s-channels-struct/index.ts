import WebSocket from 'ws';
import fetch from 'node-fetch';
import { z } from 'zod';

// --- CONFIGURATION ---
// Using the FQDN to reach the 'kwirth' namespace from 'default'
const KWIRTH_BASE_WS = 'ws://kwirth-svc.kwirth.svc.cluster.local:3883/kwirth/e3745642-c935-418b-b718-d3e09be7022c';
const VLLM_URL = (process.env.VLLM_BASE_URL || 'http://vllm-service.default.svc.cluster.local/v1').replace(/\/$/, '') + '/chat/completions';
const MODEL_NAME = 'Qwen/Qwen2.5-1.5B-Instruct';

// AI Throttle: Maximum once every 10 seconds to prevent spamming the LLM
const AI_COOLDOWN_MS = 10000; 
let isAiRunning = false;
let lastAiRunTime = 0;

// --- STRUCTURED OUTPUT SCHEMA ---
const K8SDiagnostic = z.object({
    findings: z.array(
        z.object({
            description: z.string().min(1).describe("The technical issue found"),
            level: z.enum(['low', 'medium', 'high', 'critical']).describe("Severity of the issue"),
            suggested_command: z.string().optional().describe("A kubectl command to fix it")
        })
    ),
    decision: z.object({
        tool: z.enum(['get_logs', 'get_events', 'list_files', 'final_answer']),
        parameters: z.record(z.any()).optional()
    })
});

// --- LIVE STATE CACHE ---
let clusterState = {
    pods: {},
    logs: {},
    events: []
};

// --- AI EXECUTION LOGIC ---
async function runDiagnostic() {
    console.log("\n--- 🔍 REACTIVE SCAN TRIGGERED ---");
    
    const context = {
        inventory: clusterState.pods,
        recent_logs: clusterState.logs,
        system_events: clusterState.events
    };

    const prompt = `System: You are a Kubernetes SRE. Analyze the cluster state.
Return ONLY a JSON object matching this schema:
{
  "findings": [{"description": string, "level": "low"|"medium"|"high"|"critical", "suggested_command": string}],
  "decision": {"tool": "get_logs"|"get_events"|"list_files"|"final_answer", "parameters": {}}
}

Current State: ${JSON.stringify(context)}`;

    try {
        const response = await fetch(VLLM_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: MODEL_NAME,
                messages: [{ role: "user", content: prompt }],
                temperature: 0,
                response_format: { type: "json_object" }
            })
        });

        const data = await response.json();
        if (!data.choices) throw new Error("Invalid response from vLLM");

        const rawContent = data.choices[0].message.content;
        const result = K8SDiagnostic.parse(JSON.parse(rawContent));

        console.log("🤖 AI ANALYSIS:");
        result.findings.forEach(f => {
            console.log(` >> [${f.level.toUpperCase()}] ${f.description}`);
            if (f.suggested_command) console.log(`    FIX: ${f.suggested_command}`);
        });

    } catch (err) {
        if (err instanceof z.ZodError) {
            console.error("❌ AI Schema Mismatch:", err.errors);
        } else {
            console.error("❌ Diagnostic Failed:", err.message);
        }
    }
}

// --- ASYNC TRIGGER ---
async function triggerAiIfReady() {
    const now = Date.now();
    if (!isAiRunning && (now - lastAiRunTime) > AI_COOLDOWN_MS) {
        isAiRunning = true;
        await runDiagnostic();
        lastAiRunTime = Date.now();
        isAiRunning = false;
    }
}

// --- KWIRTH ASYNC STREAMS ---
function connectToKwirth() {
    const logWs = new WebSocket(`${KWIRTH_BASE_WS}/channel/log`);
    const metricsWs = new WebSocket(`${KWIRTH_BASE_WS}/channel/metrics`);
    const alertWs = new WebSocket(`${KWIRTH_BASE_WS}/channel/alert`);

    logWs.on('open', () => console.log("✅ Connected to Log Stream"));
    metricsWs.on('open', () => console.log("✅ Connected to Metrics Stream"));
    alertWs.on('open', () => console.log("✅ Connected to Alert Stream"));

    logWs.on('message', (data) => {
        const msg = JSON.parse(data);
        if (msg.pod && msg.log) {
            clusterState.logs[msg.pod] = ((clusterState.logs[msg.pod] || "") + msg.log).slice(-500);
            triggerAiIfReady(); // React to incoming logs
        }
    });

    metricsWs.on('message', (data) => {
        const msg = JSON.parse(data);
        if (msg.name && msg.type === 'pod') {
            clusterState.pods[msg.name] = { 
                status: msg.status || "Unknown", 
                cpu: msg.cpu, 
                memory: msg.memory 
            };
            triggerAiIfReady(); // React to metric changes
        }
    });

    alertWs.on('message', (data) => {
        const msg = JSON.parse(data);
        clusterState.events.push(`[${msg.severity}] ${msg.message}`);
        if (clusterState.events.length > 10) clusterState.events.shift();
        triggerAiIfReady(); // React to alerts immediately
    });

    logWs.on('error', (e) => console.error("WS Error (Log):", e.message));
    metricsWs.on('error', (e) => console.error("WS Error (Metrics):", e.message));
    alertWs.on('error', (e) => console.error("WS Error (Alert):", e.message));
}

// --- ENTRY POINT ---
function main() {
    console.log("🚀 Starting Agent in Reactive Mode...");
    connectToKwirth();
    // The event loop stays alive as long as the WebSocket connections are open.
}

main();
