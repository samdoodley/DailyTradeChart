# DailyTradeChart

A TradingView-style daily trading desk for Indian markets focused on 3-minute charts.

## Features

- 3-minute candlestick chart view
- Nifty 50 stock scan for eligible trades
- Auto-pick best trade signal
- Paper trade execution with risk controls
- Daily capital and profit target tracking
- Trade journal and positions book
- Clear, mobile-friendly dashboard

## Run locally

```bash
npm install
npm run dev -- --host 0.0.0.0
```

Then open http://localhost:5173

## Plan

- Daily capital: ₹2,00,000
- Daily target: ₹5,000
- Risk per trade: 0.6% of equity or smaller
- Trade timeframe: 3-minute candles
- Market universe: Nifty 50 candidates
- App logic: scan for trend + momentum + volume + price structure before entry

## Important note

This project is a paper-trading and strategy-execution prototype. It does not provide live broker execution or financial advice.
