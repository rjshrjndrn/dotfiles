---
name: stock-analyzer
description: Analyze stocks to find discounted/undervalued opportunities using fundamental metrics
---

# Stock Discount Analyzer

Analyze stocks to identify undervalued or discounted investment opportunities using fundamental analysis.

## When to Use

- User asks to find discounted or undervalued stocks
- User wants to analyze a stock for value investing
- User asks about stock valuation metrics

## Analysis Process

1. **Fetch Stock Data**: Use `yahoo-datasets_get_stock_info` to retrieve current stock information
2. **Fetch Financials**: Use `yahoo-datasets_get_financial_statement` for income_stmt and balance_sheet
3. **Get Recommendations**: Use `yahoo-datasets_get_recommendations` to see analyst sentiment

## Key Discount Indicators

Evaluate these metrics to determine if a stock is undervalued:

### Valuation Ratios
- **P/E Ratio**: Compare to industry average. Below 15 may indicate undervaluation
- **Forward P/E**: Lower than trailing P/E suggests expected earnings growth
- **P/B Ratio**: Below 1.0 may indicate stock trades below book value
- **PEG Ratio**: Below 1.0 suggests undervaluation relative to growth
- **Price to Sales (P/S)**: Compare to sector peers

### Financial Health
- **Current Ratio**: Above 1.5 indicates good liquidity
- **Debt to Equity**: Below 0.5 is generally healthy
- **Free Cash Flow**: Positive and growing is preferred
- **Return on Equity (ROE)**: Above 15% indicates efficiency

### Discount Calculation
```
Discount % = ((Fair Value - Current Price) / Fair Value) * 100

Fair Value Methods:
1. Graham Number = sqrt(22.5 * EPS * Book Value)
2. DCF = Sum of discounted future cash flows
3. Peer Comparison = Average sector P/E * Company EPS
```

## Output Format

Provide analysis in this structure:

```
STOCK ANALYSIS: [TICKER]
========================
Current Price: $XX.XX
52-Week Range: $XX.XX - $XX.XX

VALUATION METRICS:
- P/E Ratio: XX.X (Industry Avg: XX.X)
- Forward P/E: XX.X
- P/B Ratio: XX.X
- PEG Ratio: XX.X

FINANCIAL HEALTH:
- Current Ratio: XX.X
- Debt/Equity: XX.X
- ROE: XX.X%
- Free Cash Flow: $XXB

DISCOUNT ANALYSIS:
- Graham Number: $XX.XX
- Current vs Graham: XX% [discount/premium]
- Analyst Consensus: [Buy/Hold/Sell]
- Price Targets: Low $XX | Avg $XX | High $XX

VERDICT: [Undervalued/Fair Value/Overvalued]
Confidence: [High/Medium/Low]
Key Reasons:
1. [Reason 1]
2. [Reason 2]
3. [Reason 3]
```

## What I do

To analyze AAPL for discount:
1. Call `yahoo-datasets_get_stock_info` with ticker="AAPL"
2. Call `yahoo-datasets_get_financial_statement` with ticker="AAPL", financial_type="income_stmt"
3. Call `yahoo-datasets_get_recommendations` with ticker="AAPL", recommendation_type="recommendations"
4. Calculate discount metrics and provide verdict

## Screening Multiple Stocks

When screening multiple tickers:
1. Fetch data for all tickers in parallel
2. Calculate discount score for each: `score = (1/PE) + (1/PB) + ROE - DebtEquity`
3. Rank by score descending
4. Present top opportunities with key metrics
