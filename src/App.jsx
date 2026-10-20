import { useEffect, useMemo, useRef, useState } from 'react';
import { createChart } from 'lightweight-charts';

const DAILY_CAPITAL = 200000;
const DAILY_TARGET = 5000;
const MAX_RISK_PER_TRADE = 0.006; // 0.6%
const MAX_POSITIONS = 2;

const NIFTY_SYMBOLS = [
  'RELIANCE', 'TCS', 'INFY', 'HDFCBANK', 'ICICIBANK', 'SBIN', 'LTIM', 'ITC',
  'SUNPHARMA', 'BAJFINANCE', 'TATAMOTORS', 'ONGC', 'BHARTIARTL', 'NTPC',
  'AXISBANK', 'KOTAKBANK', 'POWERGRID', 'HINDUNILVR', 'ASIANPAINT', 'TITAN'
];

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const roundTo = (value, digits = 2) => Number(value.toFixed(digits));

function createCandle(timestamp, open, close, high, low, volume) {
  return { time: timestamp, open, high, low, close, volume };
}

function generateSeries(symbol, startPrice) {
  const series = [];
  let price = startPrice;
  const now = Date.now();

  for (let i = 220; i >= 0; i -= 1) {
    const timestamp = Math.floor((now - i * 3 * 60 * 1000) / 1000);
    const drift = Math.sin(i / 11) * 11;
    const shock = ((i % 17) - 8) * 1.3;
    const open = price;
    const close = clamp(open + drift * 0.6 + shock, startPrice * 0.82, startPrice * 1.18);
    const high = Math.max(open, close) + 8 + (i % 5);
    const low = Math.min(open, close) - 8 - (i % 4);
    const volume = 900 + ((i * 19) % 3000) + (Math.abs(close - open) * 220);

    series.push(createCandle(timestamp, open, close, high, low, volume));
    price = close;
  }

  return series;
}

function calcEMA(values, period) {
  if (values.length === 0) return 0;
  const multiplier = 2 / (period + 1);
  let ema = values[0];

  for (let i = 1; i < values.length; i += 1) {
    ema = (values[i] - ema) * multiplier + ema;
  }

  return ema;
}

function calcRSI(closes, period = 14) {
  if (closes.length < period + 1) return 50;

  let gains = 0;
  let losses = 0;

  for (let i = 1; i < period + 1; i += 1) {
    const diff = closes[closes.length - i] - closes[closes.length - i - 1];
    if (diff >= 0) gains += diff;
    else losses += Math.abs(diff);
  }

  const avgGain = gains / period;
  const avgLoss = losses / period;

  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

function computeSignal(symbolData) {
  const closes = symbolData.map((point) => point.close);
  const volumes = symbolData.map((point) => point.volume);
  const lastBar = symbolData[symbolData.length - 1];
  const prevBar = symbolData[symbolData.length - 2] || lastBar;
  const ema9 = calcEMA(closes, 9);
  const ema21 = calcEMA(closes, 21);
  const volumeAvg = volumes.slice(-20).reduce((sum, v) => sum + v, 0) / 20;
  const rsi = calcRSI(closes, 14);
  const trend = lastBar.close > ema9 && ema9 > ema21;
  const momentum = (lastBar.close - prevBar.close) > 0;
  const volumeBoost = lastBar.volume > volumeAvg * 1.15;
  const rangeScore = Math.abs(lastBar.close - lastBar.open) / (lastBar.high - lastBar.low || 1);

  let score = 0;
  let reasons = [];

  if (trend) {
    score += 28;
    reasons.push('Trend up');
  }
  if (momentum) {
    score += 20;
    reasons.push('Momentum positive');
  }
  if (volumeBoost) {
    score += 18;
    reasons.push('Volume expansion');
  }
  if (rsi > 55 && rsi < 72) {
    score += 22;
    reasons.push('RSI healthy');
  }
  if (rangeScore > 0.55) {
    score += 12;
    reasons.push('Clean breakout structure');
  }

  const eligible = score >= 60;
  const direction = trend && momentum ? 'BUY' : 'WATCH';

  return {
    score,
    eligible,
    direction,
    rsi: roundTo(rsi, 1),
    volumeBoost,
    reason: reasons.slice(0, 3).join(' • ') || 'Wait for price confirmation',
    price: lastBar.close,
    ema9: roundTo(ema9, 2),
    ema21: roundTo(ema21, 2),
  };
}

function createMarketData() {
  return NIFTY_SYMBOLS.map((symbol) => {
    const basePrice = 80 + Math.random() * 1800;
    const candles = generateSeries(symbol, basePrice);
    const signal = computeSignal(candles);

    return {
      symbol,
      candles,
      ...signal,
    };
  });
}

function App() {
  const initialMarket = useMemo(() => createMarketData(), []);
  const [market, setMarket] = useState(initialMarket);
  const [selectedSymbol, setSelectedSymbol] = useState(initialMarket[0]?.symbol || 'RELIANCE');
  const [tradeMode, setTradeMode] = useState('BUY');
  const [riskPercent, setRiskPercent] = useState(0.6);
  const [positions, setPositions] = useState([]);
  const [journal, setJournal] = useState([
    { id: 1, message: 'Daily plan initialized. Target: ₹5,000. Capital: ₹2,00,000.', time: 'Now' },
  ]);
  const chartContainerRef = useRef(null);
  const chartRef = useRef(null);

  const selectedAsset = useMemo(
    () => market.find((item) => item.symbol === selectedSymbol) || market[0],
    [market, selectedSymbol]
  );

  const eligibleStocks = useMemo(
    () => [...market].filter((item) => item.eligible).sort((a, b) => b.score - a.score),
    [market]
  );

  const openPositions = positions.filter((position) => position.status === 'open');
  const realizedPnL = positions
    .filter((position) => position.status === 'closed')
    .reduce((total, position) => total + position.pnl, 0);

  const totalExposure = openPositions.reduce((sum, pos) => sum + pos.notional, 0);
  const availableCapital = DAILY_CAPITAL - totalExposure;
  const dailyTargetProgress = Math.max(0, (realizedPnL / DAILY_TARGET) * 100);

  useEffect(() => {
    if (!chartContainerRef.current || !selectedAsset) return;

    const chart = createChart(chartContainerRef.current, {
      layout: {
        background: { color: '#0b1220' },
        textColor: '#dce7f4',
      },
      grid: {
        vertLines: { color: '#1d2c42' },
        horzLines: { color: '#1d2c42' },
      },
      width: chartContainerRef.current.clientWidth,
      height: 370,
      rightPriceScale: { borderColor: '#36506d' },
      timeScale: { borderColor: '#36506d' },
    });

    const candlestickSeries = chart.addCandlestickSeries({
      upColor: '#25c281',
      downColor: '#ff5b6e',
      borderDownColor: '#ff5b6e',
      borderUpColor: '#25c281',
      wickDownColor: '#ff5b6e',
      wickUpColor: '#25c281',
    });

    candlestickSeries.setData(selectedAsset.candles);

    chartRef.current = chart;

    const resizeObserver = new ResizeObserver(() => {
      chart.applyOptions({ width: chartContainerRef.current.clientWidth });
    });

    resizeObserver.observe(chartContainerRef.current);

    return () => {
      resizeObserver.disconnect();
      chart.remove();
    };
  }, [selectedAsset]);

  const addJournalLine = (message) => {
    setJournal((prev) => [
      { id: Date.now(), message, time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) },
      ...prev,
    ]);
  };

  const autoPickTrade = () => {
    const best = eligibleStocks[0];
    if (!best) {
      addJournalLine('No trade is currently eligible under the 3-minute scanner rules.');
      return;
    }

    const entry = best.price;
    const stopDistance = Math.max(entry * 0.008, 1.5);
    const targetDistance = stopDistance * 1.8;
    const riskAmount = DAILY_CAPITAL * MAX_RISK_PER_TRADE;
    const quantity = Math.max(1, Math.floor(riskAmount / stopDistance));
    const notional = quantity * entry;

    setSelectedSymbol(best.symbol);
    setPositions((prev) => [
      ...prev,
      {
        id: Date.now(),
        symbol: best.symbol,
        qty: quantity,
        entry,
        side: 'LONG',
        stop: entry - stopDistance,
        target: entry + targetDistance,
        status: 'open',
        notional,
        pnl: 0,
      },
    ]);

    addJournalLine(`Auto trade triggered: ${best.symbol} BUY at ₹${entry.toFixed(2)} with ${quantity} qty.`);
  };

  const placeManualTrade = () => {
    const signal = market.find((item) => item.symbol === selectedSymbol);
    if (!signal) return;

    const entry = signal.price;
    const stopDistance = Math.max(entry * (riskPercent / 100), 1.5);
    const targetDistance = stopDistance * 1.8;
    const qty = Math.max(1, Math.floor((DAILY_CAPITAL * 0.02) / stopDistance));

    if (openPositions.length >= MAX_POSITIONS) {
      addJournalLine('Max open positions reached. Close a trade to place a new one.');
      return;
    }

    setPositions((prev) => [
      ...prev,
      {
        id: Date.now(),
        symbol: selectedSymbol,
        qty,
        entry,
        side: tradeMode,
        stop: tradeMode === 'BUY' ? entry - stopDistance : entry + stopDistance,
        target: tradeMode === 'BUY' ? entry + targetDistance : entry - targetDistance,
        status: 'open',
        notional: qty * entry,
        pnl: 0,
      },
    ]);

    addJournalLine(`${tradeMode} order placed for ${selectedSymbol} at ₹${entry.toFixed(2)}.`);
  };

  const closePosition = (positionId) => {
    setPositions((prev) =>
      prev.map((position) => {
        if (position.id !== positionId || position.status !== 'open') return position;

        const livePrice = market.find((meta) => meta.symbol === position.symbol)?.price || position.entry;
        const pnl = position.side === 'LONG' ? (livePrice - position.entry) * position.qty : (position.entry - livePrice) * position.qty;

        return {
          ...position,
          status: 'closed',
          pnl: roundTo(pnl, 2),
          exit: livePrice,
          closedAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        };
      })
    );

    addJournalLine('Position closed against live paper price.');
  };

  const updateMarketPulse = () => {
    setMarket((prev) =>
      prev.map((item) => {
        const nextCandles = [...item.candles];
        const last = nextCandles[nextCandles.length - 1];
        const newClose = clamp(last.close + (Math.random() - 0.48) * 12, item.candles[0].close * 0.78, item.candles[0].close * 1.22);
        const newHigh = Math.max(newClose, last.close) + 4;
        const newLow = Math.min(newClose, last.close) - 4;
        const nextCandle = {
          time: Math.floor((Date.now() + 180000) / 1000),
          open: last.close,
          high: newHigh,
          low: newLow,
          close: newClose,
          volume: last.volume + 150 + Math.random() * 500,
        };

        nextCandles.push(nextCandle);
        if (nextCandles.length > 230) nextCandles.shift();

        const signal = computeSignal(nextCandles);
        return { ...item, candles: nextCandles, ...signal };
      })
    );
  };

  useEffect(() => {
    const timer = setInterval(updateMarketPulse, 5000);
    return () => clearInterval(timer);
  }, []);

  return (
    <div className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Strategy dashboard</p>
          <h1>DailyTradeChart</h1>
        </div>
        <div className="summary-badges">
          <div className="badge orange">
            <span>Capital</span>
            <strong>₹{DAILY_CAPITAL.toLocaleString('en-IN')}</strong>
          </div>
          <div className="badge green">
            <span>Daily target</span>
            <strong>₹{DAILY_TARGET.toLocaleString('en-IN')}</strong>
          </div>
        </div>
      </header>

      <section className="stats-grid">
        <div className="stat-card">
          <label>Available capital</label>
          <strong>₹{availableCapital.toLocaleString('en-IN')}</strong>
        </div>
        <div className="stat-card">
          <label>Open positions</label>
          <strong>{openPositions.length}</strong>
        </div>
        <div className="stat-card">
          <label>Daily progress</label>
          <strong>{dailyTargetProgress.toFixed(0)}%</strong>
        </div>
        <div className="stat-card">
          <label>Realized P&L</label>
          <strong className={realizedPnL >= 0 ? 'positive' : 'negative'}>
            ₹{realizedPnL.toLocaleString('en-IN', { maximumFractionDigits: 2 })}
          </strong>
        </div>
      </section>

      <main className="content-grid">
        <section className="panel-wide">
          <div className="panel-header">
            <h2>3-minute chart</h2>
            <div className="ticker-box">
              <select value={selectedSymbol} onChange={(e) => setSelectedSymbol(e.target.value)}>
                {market.map((item) => (
                  <option key={item.symbol} value={item.symbol}>{item.symbol}</option>
                ))}
              </select>
              <button onClick={autoPickTrade}>Auto pick trade</button>
            </div>
          </div>

          <div className="chart-meta">
            <span className={`signal-tag ${selectedAsset?.eligible ? 'eligible' : ''}`}>
              {selectedAsset?.eligible ? 'Eligible' : 'Watch'}
            </span>
            <span>3m TF</span>
            <span>RSI {selectedAsset?.rsi}</span>
            <span>Score {selectedAsset?.score || 0}</span>
          </div>

          <div ref={chartContainerRef} className="chart-box" />
        </section>

        <aside className="panel-order">
          <h2>Trade ticket</h2>

          <label>
            Direction
            <select value={tradeMode} onChange={(e) => setTradeMode(e.target.value)}>
              <option value="BUY">BUY</option>
              <option value="SELL">SELL</option>
            </select>
          </label>

          <label>
            Risk %
            <input
              type="number"
              min="0.2"
              max="2"
              step="0.1"
              value={riskPercent}
              onChange={(e) => setRiskPercent(Number(e.target.value))}
            />
          </label>

          <div className="order-line">
            <span>Symbol</span>
            <strong>{selectedSymbol}</strong>
          </div>

          <div className="order-line">
            <span>Entry</span>
            <strong>₹{Number(selectedAsset?.price || 0).toFixed(2)}</strong>
          </div>

          <button className="primary" onClick={placeManualTrade}>Place paper trade</button>

          <div className="plan-box">
            <h3>Execution plan</h3>
            <ul>
              <li>Max risk per trade: {MAX_RISK_PER_TRADE * 100}%</li>
              <li>Daily target: ₹{DAILY_TARGET.toLocaleString('en-IN')}</li>
              <li>Max open trades: {MAX_POSITIONS}</li>
              <li>Pre-entry: trend + momentum + volume</li>
            </ul>
          </div>
        </aside>

        <section className="panel scanner-panel">
          <div className="panel-header">
            <h2>Scanner</h2>
            <span>{eligibleStocks.length} eligible</span>
          </div>

          <div className="scanner-list">
            {market.map((item) => (
              <button
                key={item.symbol}
                className={`scanner-row ${selectedSymbol === item.symbol ? 'active' : ''}`}
                onClick={() => setSelectedSymbol(item.symbol)}
              >
                <div>
                  <strong>{item.symbol}</strong>
                  <small>{item.reason}</small>
                </div>
                <div className="scanner-metrics">
                  <span className={item.eligible ? 'positive' : 'negative'}>{item.eligible ? 'Eligible' : 'Watch'}</span>
                  <span>₹{item.price.toFixed(2)}</span>
                </div>
              </button>
            ))}
          </div>
        </section>

        <section className="panel positions-panel">
          <div className="panel-header">
            <h2>Positions</h2>
            <span>{openPositions.length} open</span>
          </div>

          <div className="position-list">
            {openPositions.length === 0 ? (
              <p className="empty-state">No open paper trades yet. Use Auto pick or place a trade.</p>
            ) : (
              openPositions.map((position) => (
                <div key={position.id} className="position-card">
                  <div className="position-topline">
                    <strong>{position.symbol}</strong>
                    <span>{position.side}</span>
                  </div>
                  <div className="position-row">
                    <span>Entry</span>
                    <strong>₹{position.entry.toFixed(2)}</strong>
                  </div>
                  <div className="position-row">
                    <span>Stop</span>
                    <strong>₹{position.stop.toFixed(2)}</strong>
                  </div>
                  <div className="position-row">
                    <span>Target</span>
                    <strong>₹{position.target.toFixed(2)}</strong>
                  </div>
                  <button className="secondary" onClick={() => closePosition(position.id)}>Close</button>
                </div>
              ))
            )}
          </div>
        </section>

        <section className="panel journal-panel">
          <div className="panel-header">
            <h2>Trade journal</h2>
            <span>Paper mode</span>
          </div>

          <div className="journal-list">
            {journal.map((item) => (
              <div key={item.id} className="journal-item">
                <small>{item.time}</small>
                <p>{item.message}</p>
              </div>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}

export default App;
