---
name: browser-use
description: >
  Browser automation via Browser Use Cloud API. Handles full lifecycle: account creation
  via challenge-response signup, session dispatch, polling, and result extraction.
  Use when user needs web browsing, scraping, flight search, price comparison, form filling,
  or any task requiring a real browser agent. Trigger: "browser use", "browse", "use browser agent",
  "automate browser", or any task needing real browser interaction beyond simple page fetch.
license: MIT
metadata:
  author: pi
  version: "1.0"
  api_base: "https://api.browser-use.com"
---

# Browser Use Cloud Automation

Automate real browser tasks via Browser Use Cloud API. Always start from account creation — keys are ephemeral.

## Step 1: Create Account (Challenge-Response)

Every session starts fresh. No stored keys.

```bash
# 1a. Request challenge
curl -s -X POST https://api.browser-use.com/cloud/signup \
  -H "Content-Type: application/json" \
  -d '{}'
# Response: {"challenge_id":"uuid","challenge_text":"..."}

# 1b. Read challenge_text, solve the math problem
# Challenge text has obfuscated characters (random punctuation/casing)
# Strip noise, parse natural language math, compute answer
# Format answer as string with 2 decimal places: "49.00"

# 1c. Verify and get API key
curl -s -X POST https://api.browser-use.com/cloud/signup/verify \
  -H "Content-Type: application/json" \
  -d '{"challenge_id":"uuid","answer":"49.00"}'
# Response: {"api_key":"bu_..."}
```

### Challenge Solving Tips
- Text is heavily obfuscated with random symbols, casing, brackets, punctuation
- Strip all non-alpha characters except spaces, normalize to lowercase
- Common patterns: "take the Nth prime", "multiply by sum of first N even/odd numbers", "subtract from X"
- Answer MUST be string with exactly 2 decimal places: `"144.00"`, `"49.00"`
- Prime sequence: 2, 3, 5, 7, 11, 13, 17, 19, 23, 29
- "Even numbers greater than three": 4, 6, 8, 10, ...
- "Odd numbers less than ten": 1, 3, 5, 7, 9

## Step 2: Dispatch Browser Agent Session

```bash
curl -s -X POST https://api.browser-use.com/api/v3/sessions \
  -H "X-Browser-Use-API-Key: bu_..." \
  -H "Content-Type: application/json" \
  -d '{
    "task": "Natural language instruction for the browser agent",
    "model": "claude-sonnet-4.6",
    "proxyCountryCode": "us",
    "maxCostUsd": 2,
    "outputSchema": { ... }
  }'
```

### Key Parameters
| Parameter | Default | Notes |
|-----------|---------|-------|
| `task` | required | Natural language instruction. Be specific and detailed |
| `model` | `claude-opus-4.7` | Options: `gemini-3-flash` (fast/cheap), `claude-sonnet-4.6` (balanced), `claude-opus-4.7` (best) |
| `proxyCountryCode` | `us` | Route through specific country. Use `fr` for French sites, `in` for Indian, etc. Set `null` to disable |
| `maxCostUsd` | auto | Budget cap. $2-5 typical for search tasks |
| `outputSchema` | null | JSON Schema for structured output. Highly recommended |
| `keepAlive` | false | Set true to send follow-up tasks to same session |
| `enableRecording` | false | Set true to get video recording URLs |
| `sensitiveData` | null | Key-value pairs for passwords/keys. Agent uses `<secret>key</secret>` placeholders |

### Model Selection Guide
- **`gemini-3-flash`**: Simple lookups, single-page scrapes. Cheapest
- **`claude-sonnet-4.6`**: Multi-step searches, comparisons, filtering. Good balance
- **`claude-opus-4.7`**: Complex multi-site research, nuanced decisions. Most capable

### Writing Good Tasks
- Be explicit about the site to visit (include URL)
- State all filters/constraints clearly
- Specify what data to collect and format
- Mention what to EXCLUDE (e.g., "no Delhi layovers")
- Request specific fields in output

Example task:
```
Go to Google Flights (https://www.google.com/travel/flights).
Search for one-way flights from CDG to TRV for August 2026.
Filters: under 16 hours total, no Delhi (DEL) layover.
Sort by cheapest. Collect top 5: airline, date, times, duration, stops, layover cities, price EUR.
```

## Step 3: Poll for Results

Sessions run async. Poll until `status` is `stopped`, `error`, or `timed_out`.

```bash
# Poll every 30-60 seconds
curl -s "https://api.browser-use.com/api/v3/sessions/{session_id}" \
  -H "X-Browser-Use-API-Key: bu_..."
```

### Status Values
| Status | Meaning |
|--------|---------|
| `created` | Sandbox starting |
| `idle` | Ready, waiting for task |
| `running` | Task executing |
| `stopped` | Complete — check `output` and `isTaskSuccessful` |
| `timed_out` | Took too long |
| `error` | Failed |

### Polling Strategy
1. First poll after 30s
2. Then every 30-60s
3. Parse response with jq/python — extract `status`, `stepCount`, `lastStepSummary`, `output`
4. On `stopped`: check `isTaskSuccessful` and `output`
5. Total cost in `totalCostUsd`

### Compact Polling Script
```bash
curl -s "https://api.browser-use.com/api/v3/sessions/{ID}" \
  -H "X-Browser-Use-API-Key: bu_..." | python3 -c "
import json,sys
d=json.load(sys.stdin)
print(f'Status: {d[\"status\"]} | Steps: {d[\"stepCount\"]} | Cost: \${d[\"totalCostUsd\"]}')
if d.get('lastStepSummary'): print(f'Last: {d[\"lastStepSummary\"]}')
if d.get('output'): print(json.dumps(d['output'], indent=2))
"
```

## Step 4: (Optional) Claim Account

Generate a claim URL so a human can take over the account in a browser:

```bash
curl -s -X POST https://api.browser-use.com/cloud/signup/claim \
  -H "X-Browser-Use-API-Key: bu_..." \
  -H "Content-Type: application/json"
# Response: {"claim_url":"https://cloud.browser-use.com/claim?token=..."}
# Valid for 1 hour
```

## Output Schema Examples

### Flight Search
```json
{
  "type": "object",
  "properties": {
    "flights": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "airline": {"type": "string"},
          "departure_date": {"type": "string"},
          "departure_time": {"type": "string"},
          "arrival_time": {"type": "string"},
          "total_duration": {"type": "string"},
          "stops": {"type": "integer"},
          "layover_cities": {"type": "string"},
          "price": {"type": "string"}
        }
      }
    },
    "cheapest_price": {"type": "string"},
    "search_summary": {"type": "string"},
    "notes": {"type": "string"}
  }
}
```

### Price Comparison
```json
{
  "type": "object",
  "properties": {
    "products": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "name": {"type": "string"},
          "price": {"type": "string"},
          "url": {"type": "string"},
          "rating": {"type": "string"},
          "seller": {"type": "string"}
        }
      }
    },
    "best_deal": {"type": "string"},
    "notes": {"type": "string"}
  }
}
```

### Generic Scrape
```json
{
  "type": "object",
  "properties": {
    "data": {"type": "array", "items": {"type": "object"}},
    "source_url": {"type": "string"},
    "extracted_at": {"type": "string"},
    "summary": {"type": "string"}
  }
}
```

## Cost Reference
- `gemini-3-flash`: ~$0.10-0.30/task
- `claude-sonnet-4.6`: ~$0.30-1.00/task  
- `claude-opus-4.7`: ~$0.50-2.00/task
- Browser time: ~$0.02/min
- Proxy: minimal per MB

## Error Handling
- Challenge fails → retry signup (new challenge each time)
- Session errors → check `lastStepSummary` for clues, retry with clearer task
- Budget exceeded → increase `maxCostUsd` or use cheaper model
- Timeout → task too complex, break into smaller sub-tasks
- Use `keepAlive: true` + `sessionId` for multi-step workflows
