# Bundled license texts (REQUIRED before shipping the bundled installer)

The bundled-offline installer redistributes third-party components. Their VERBATIM license
texts MUST be present in this directory before that installer is built/released. Do NOT
hand-write or paste these from memory — copy them from the authoritative source URLs below
and verify byte-for-byte.

Required files:

1. `LLAMA-3.1-COMMUNITY-LICENSE.txt`
   Source: https://www.llama.com/llama3_1/license/  (Meta Llama 3.1 Community License)

2. `LLAMA-3.1-AUP.txt`
   Source: https://www.llama.com/llama3_1/use-policy/  (Llama 3.1 Acceptable Use Policy)

3. `OLLAMA-MIT.txt`
   Source: https://github.com/ollama/ollama/blob/main/LICENSE  (Ollama, MIT — copy verbatim incl. the exact copyright line)

The CI bundle workflow (Phase 4) fetches and verifies these; alternatively drop them in manually.
The online-track installer does not redistribute weights, so it does not require these files.

Attribution shown in-app (factual, safe to commit): "Built with Llama."
