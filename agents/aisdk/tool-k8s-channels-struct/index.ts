import WebSocket from 'ws';
import fetch from 'node-fetch';
import { z } from 'zod';

// --- CONFIGURATION ---
const KWIRTH_BASE_WS = 'ws://kwirth-svc.kwirth.svc.cluster.local:3883/kwirth/e3745642-c935-418b-b718-d3e09be7022c';
const VLLM_URL = (process.env.VLLM_BASE_URL || 'http://vllm-service.default.svc.cluster.local/v1').replace(/\/$/, '') + '/chat/completions';
const MODEL_NAME = 'Qwen/Qwen2.5-1.5B-Instruct';
const CHECK_INTERVAL_MS = 60000;

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

// --- KWIRTH ASYNC STREAMING ---
function connectToKwirth() {
    const logWs = new WebSocket(`${KWIRTH_BASE_WS}/channel/log`);
    const metricsWs = new WebSocket(`${KWIRTH_BASE_WS}/channel/metrics`);
    const alertWs = new WebSocket(`${KWIRTH_BASE_WS}/channel/alert`);

    logWs.on('message', (data) => {
        const msg = JSON.parse(data);
        if (msg.pod && msg.log) {
            clusterState.logs[msg.pod] = ((clusterState.logs[msg.pod] || "") + msg.log).slice(-500);
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
        }
    });

    alertWs.on('message', (data) => {
        const msg = JSON.parse(data);
        clusterState.events.push(`[${msg.severity}] ${msg.message}`);
        if (clusterState.events.length > 10) clusterState.events.shift();
    });

    console.log("🚀 Connected to Kwirth Live Streams");
}

// --- AI EXECUTION WITH STRUCTURED OUTPUT ---
async function runDiagnostic() {
    console.log("\n--- 🔍 SCANNING CLUSTER ---");
    
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
        const rawContent = data.choices[0].message.content;
        
        // Validate against the K8SDiagnostic schema
        const result = K8SDiagnostic.parse(JSON.parse(rawContent));

        console.log("🤖 AI STRUCTURED ANALYSIS:");
        result.findings.forEach(f => {
            console.log(` >> [${f.level.toUpperCase()}] ${f.description}`);
            if (f.suggested_command) console.log(`    FIX: ${f.suggested_command}`);
        });

        if (result.decision.tool === 'final_answer') {
            console.log("🎯 DIAGNOSIS COMPLETE.");
        } else {
            console.log(`🛠️ NEXT TOOL: ${result.decision.tool} with params: ${JSON.stringify(result.decision.parameters)}`);
        }

    } catch (err) {
        if (err instanceof z.ZodError) {
            console.error("❌ AI failed to follow K8SDiagnostic schema:", err.errors);
        } else {
            console.error("❌ Diagnostic Failed:", err.message);
        }
    }
}

async function main() {
    connectToKwirth();
    while (true) {
        await runDiagnostic();
        await new Promise(r => setTimeout(r, CHECK_INTERVAL_MS));
    }
}

main();
