---
description: Local OpenAI proxy using free browser LLMs.
name: local-openai-proxy
version: "1.0.0"
author: hermes-agent
license: MIT
---

# Local OpenAI-Compatible Proxy

Trigger: Use when setting up a local free-tier browser LLM endpoint (`localhost:3001`) that exposes `/v1/chat/completions` and `/v1/models` backed by ChatGPT/Gemini web adapters.

## Setup
- `npm run setup:login` saves `.profiles/` session
- `npm run openai-proxy` starts `src/openai-layer.ts` (`PersistentBrowserRuntime`)

## Client config (FreeLLMAPI / custom endpoint)
- `base_url`: `http://localhost:3001/v1`
- `api_key`: `sk-dummy` (not validated)
- Models: `gpt-4` (ChatGPT), `gemini-1.5` (Gemini)

## Subagent / Hermes usage
- Direct HTTP call to `localhost:3001/v1/chat/completions`
- Pin model via `delegation.model` or include endpoint in subagent `context`
- Default inheritance from parent session applies unless overridden
