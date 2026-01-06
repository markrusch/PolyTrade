// public/app.js
// Trader Dashboard frontend: WS client, chart rendering, dual YES/NO markets

const wsUrl = `/stream`;
let ws = null;
let spotChart = null;
let yesOddsChart = null;
let noOddsChart = null;

const CHART_WINDOW_MINUTES = 30; // Extended to prevent data loss with trade markers
const MAX_POINTS = 18000; // 30min * 10 ticks/sec * 60sec = max ~18k points
let renderScheduled = false;
let pendingStart = null; // store start payload until WS ready

const state = {
  market: { slug: null, asset: null, strike: null, endDate: null },
  yesData: {
    xs: [],
    bid: [],
    mid: [],
    ask: [],
    impliedProb: [],
  },
  noData: {
    xs: [],
    bid: [],
    mid: [],
    ask: [],
    impliedProb: [],
  },
  spotData: {
    xs: [],
    spot: [],
    strike: [],
  },
  current: {
    spot: null,
    strike: null,
    yes: { bid: null, ask: null, mid: null, bids: [], asks: [], trades: [] },
    no: { bid: null, ask: null, mid: null, bids: [], asks: [], trades: [] },
    iv: null,
    impliedProbYes: null,
    impliedProbNo: null,
    yesFairDist: { bidDist: null, askDist: null },
    noFairDist: { bidDist: null, askDist: null },
  },
  // Track trade markers for chart annotations
  yesTradeMarkers: [],
  noTradeMarkers: [],
};

// WebSocket connection
function connect() {
  const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${protocol}://${location.host}${wsUrl}`);
  
  document.getElementById('status').textContent = 'Connecting...';
  document.getElementById('status').className = '';

  ws.onopen = () => {
    console.log('[WS] Connected');
    document.getElementById('status').textContent = 'Ready - Click Start';
    document.getElementById('status').className = '';

    // If a start was requested before WS was ready, send it now
    if (pendingStart) {
      console.log('[WS] Sending pending start');
      ws.send(JSON.stringify(pendingStart));
      pendingStart = null;
    }
  };

  ws.onmessage = (evt) => {
    try {
      const msg = JSON.parse(evt.data);
      handleMessage(msg);
    } catch (err) {
      console.error('[WS] Parse error:', err);
    }
  };

  ws.onclose = () => {
    console.warn('[WS] Disconnected');
    document.getElementById('status').textContent = 'Disconnected';
    document.getElementById('status').className = 'disconnected';
    setTimeout(connect, 2000);
  };

  ws.onerror = (err) => {
    console.error('[WS] Error:', err);
    document.getElementById('status').className = 'disconnected';
  };
}

function handleMessage(msg) {
  if (msg.type === 'tick') {
    onTick(msg.data);
  } else if (msg.type === 'status') {
    console.log('[Status]', msg);
    if (msg.status) {
      document.getElementById('status').textContent = `Status: ${msg.status}`;
      if (msg.status === 'started') document.getElementById('status').className = '';
      if (msg.status === 'stopped') document.getElementById('status').className = '';
    }
  } else if (msg.type === 'error') {
    console.error('[Error]', msg.error);
    document.getElementById('status').textContent = `Error: ${msg.error}`;
    document.getElementById('status').className = 'disconnected';
  }
}

function startAggregator() {
  const slug = document.getElementById('slugInput').value.trim();
  const asset = document.getElementById('assetInput').value.trim();
  
  if (!slug) {
    alert('Please enter a market slug');
    return;
  }
  
  if (!asset) {
    alert('Please enter an asset (e.g., ETH)');
    return;
  }
  
  console.log('[UI] Starting aggregator:', slug, asset);
  document.getElementById('status').textContent = 'Starting...';
  
  // Reset data so charts/trades cleanly show new session
  state.yesData = { xs: [], bid: [], mid: [], ask: [], impliedProb: [] };
  state.noData = { xs: [], bid: [], mid: [], ask: [], impliedProb: [] };
  state.spotData = { xs: [], spot: [], strike: [] };
  state.yesTradeMarkers = [];
  state.noTradeMarkers = [];
  state.current = {
    spot: null,
    strike: null,
    yes: { bid: null, ask: null, mid: null, bids: [], asks: [], trades: [] },
    no: { bid: null, ask: null, mid: null, bids: [], asks: [], trades: [] },
    iv: null,
    impliedProbYes: null,
    impliedProbNo: null,
    yesFairDist: { bidDist: null, askDist: null },
    noFairDist: { bidDist: null, askDist: null },
  };

  const payload = { action: 'start', slug, asset, assetIds: [] };

  if (!ws || ws.readyState !== WebSocket.OPEN) {
    console.warn('[UI] WS not ready, reconnecting...');
    pendingStart = payload;
    connect();
    return;
  }

  ws.send(JSON.stringify(payload));
  
  // Request historical data after a short delay to populate charts with existing data
  setTimeout(() => loadHistoricalData(), 2000);
  
  // Load available expiries after successful start
  setTimeout(() => loadAvailableExpiries(), 3000);
}

function stopAggregator() {
  console.log('[UI] Stopping aggregator');
  ws.send(JSON.stringify({ action: 'stop' }));
  document.getElementById('status').textContent = 'Stopped';
}

async function loadHistoricalData() {
  try {
    console.log('[UI] Loading historical data...');
    const resp = await fetch(`/api/history?minutes=${CHART_WINDOW_MINUTES}`);
    if (!resp.ok) {
      console.warn('[UI] Failed to load history:', resp.status);
      return;
    }
    const data = await resp.json();
    if (!data.success || !data.history || data.history.length === 0) {
      console.log('[UI] No historical data available yet');
      return;
    }
    
    console.log(`[UI] Loaded ${data.history.length} historical ticks`);
    
    // Process each historical tick to populate time series
    data.history.forEach(tick => {
      processHistoricalTick(tick);
    });
    
    // Render charts with historical data
    scheduleRender();
  } catch (err) {
    console.error('[UI] Error loading history:', err);
  }
}

function processHistoricalTick(tick) {
  const t = new Date(tick.ts);
  const { spot, strike, polymarket, deribit } = tick;
  
  // Add to spot data
  state.spotData.xs.push(t);
  state.spotData.spot.push(spot);
  state.spotData.strike.push(strike);
  
  // Add to YES data
  state.yesData.xs.push(t);
  state.yesData.bid.push(polymarket?.yes?.bid);
  state.yesData.mid.push(polymarket?.yes?.mid);
  state.yesData.ask.push(polymarket?.yes?.ask);
  state.yesData.impliedProb.push(deribit?.impliedProbYes);
  
  // Add to NO data
  state.noData.xs.push(t);
  state.noData.bid.push(polymarket?.no?.bid);
  state.noData.mid.push(polymarket?.no?.mid);
  state.noData.ask.push(polymarket?.no?.ask);
  state.noData.impliedProb.push(deribit?.impliedProbNo);
}

async function loadAvailableExpiries() {
  try {
    console.log('[UI] Loading available expiries...');
    const resp = await fetch('/api/expiries');
    if (!resp.ok) {
      console.warn('[UI] Failed to load expiries:', resp.status);
      return;
    }
    const data = await resp.json();
    if (!data.success || !data.expiries || data.expiries.length === 0) {
      console.log('[UI] No expiries available');
      document.getElementById('expirySelect').innerHTML = '<option value="">No expiries available</option>';
      return;
    }
    
    console.log(`[UI] Loaded ${data.expiries.length} expiries`);
    
    const select = document.getElementById('expirySelect');
    select.innerHTML = '';
    
    data.expiries.forEach(expiry => {
      const expiryDate = new Date(expiry);
      const daysUntil = Math.ceil((expiryDate - new Date()) / (1000 * 60 * 60 * 24));
      const label = `${expiryDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })} (${daysUntil}d)`;
      
      const option = document.createElement('option');
      option.value = expiry;
      option.textContent = label;
      select.appendChild(option);
    });
    
    // Set up change handler
    select.onchange = () => {
      const selectedExpiry = select.value;
      if (selectedExpiry && ws && ws.readyState === WebSocket.OPEN) {
        console.log('[UI] Changing expiry to:', selectedExpiry);
        ws.send(JSON.stringify({ action: 'set_expiry', expiry: selectedExpiry }));
      }
    };
  } catch (err) {
    console.error('[UI] Error loading expiries:', err);
  }
}

function onTick(tick) {
  const { ts, spot, strike, endDate, polymarket, deribit } = tick;
  
  // Update market info
  if (strike !== undefined && strike !== null) {
    state.market.strike = strike;
    state.current.strike = strike;
    document.getElementById('marketStrike').textContent = strike.toFixed(2);
  }
  if (endDate) {
    state.market.endDate = endDate;
    document.getElementById('marketExpiry').textContent = new Date(endDate).toLocaleDateString();
  }
  
  // Update current spot
  if (spot !== undefined && spot !== null) {
    state.current.spot = spot;
  }
  
  // Update YES market data
  if (polymarket?.yes) {
    state.current.yes = {
      bid: polymarket.yes.bid,
      ask: polymarket.yes.ask,
      mid: polymarket.yes.mid,
      bids: polymarket.yes.bids || [],
      asks: polymarket.yes.asks || [],
      trades: polymarket.yes.recentTrades || [],
    };
  }
  
  // Update NO market data
  if (polymarket?.no) {
    state.current.no = {
      bid: polymarket.no.bid,
      ask: polymarket.no.ask,
      mid: polymarket.no.mid,
      bids: polymarket.no.bids || [],
      asks: polymarket.no.asks || [],
      trades: polymarket.no.recentTrades || [],
    };
  }
  
  // Update implied probabilities
  if (deribit) {
    state.current.iv = deribit.atmIv;
    state.current.impliedProbYes = deribit.impliedProbYes;
    state.current.impliedProbNo = deribit.impliedProbNo;
    
    // Update Deribit expiry in dropdown if present
    if (deribit.expiry) {
      const select = document.getElementById('expirySelect');
      if (select && select.value !== deribit.expiry) {
        // Find and select the matching option
        for (let i = 0; i < select.options.length; i++) {
          if (select.options[i].value === deribit.expiry) {
            select.selectedIndex = i;
            break;
          }
        }
      }
    }
  }
  
  // Update fair value distances
  if (tick.fairValue) {
    state.current.yesFairDist = tick.fairValue.yes || { bidDist: null, askDist: null };
    state.current.noFairDist = tick.fairValue.no || { bidDist: null, askDist: null };
  }
  
  // Track new trades for chart annotations
  if (polymarket?.yes?.recentTrades) {
    const newYesTrades = polymarket.yes.recentTrades.filter(trade => {
      // Only add trades from last tick (within last 2 seconds)
      return !state.yesTradeMarkers.some(m => m.ts === trade.ts && Math.abs(m.price - trade.price) < 0.0001);
    });
    newYesTrades.forEach(trade => {
      state.yesTradeMarkers.push({
        ts: new Date(trade.ts),
        price: trade.price,
        side: trade.side,
        size: trade.size,
      });
    });
    // Keep only last 50 trade markers
    if (state.yesTradeMarkers.length > 50) {
      state.yesTradeMarkers = state.yesTradeMarkers.slice(-50);
    }
  }
  
  if (polymarket?.no?.recentTrades) {
    const newNoTrades = polymarket.no.recentTrades.filter(trade => {
      return !state.noTradeMarkers.some(m => m.ts === trade.ts && Math.abs(m.price - trade.price) < 0.0001);
    });
    newNoTrades.forEach(trade => {
      state.noTradeMarkers.push({
        ts: new Date(trade.ts),
        price: trade.price,
        side: trade.side,
        size: trade.size,
      });
    });
    if (state.noTradeMarkers.length > 50) {
      state.noTradeMarkers = state.noTradeMarkers.slice(-50);
    }
  }
  
  // Add to time series data
  const t = new Date(ts);
  
  // Spot data
  state.spotData.xs.push(t);
  state.spotData.spot.push(spot);
  state.spotData.strike.push(strike);
  
  // YES market data
  state.yesData.xs.push(t);
  state.yesData.bid.push(polymarket?.yes?.bid);
  state.yesData.mid.push(polymarket?.yes?.mid);
  state.yesData.ask.push(polymarket?.yes?.ask);
  state.yesData.impliedProb.push(deribit?.impliedProbYes);
  
  // NO market data
  state.noData.xs.push(t);
  state.noData.bid.push(polymarket?.no?.bid);
  state.noData.mid.push(polymarket?.no?.mid);
  state.noData.ask.push(polymarket?.no?.ask);
  state.noData.impliedProb.push(deribit?.impliedProbNo);
  
  // Apply sliding window to all data
  const cutoff = new Date(Date.now() - CHART_WINDOW_MINUTES * 60 * 1000);
  
  // Trim spot data
  while (state.spotData.xs.length > 0 && state.spotData.xs[0] < cutoff) {
    state.spotData.xs.shift();
    state.spotData.spot.shift();
    state.spotData.strike.shift();
  }
  
  // Trim YES data
  while (state.yesData.xs.length > 0 && state.yesData.xs[0] < cutoff) {
    state.yesData.xs.shift();
    state.yesData.bid.shift();
    state.yesData.mid.shift();
    state.yesData.ask.shift();
    state.yesData.impliedProb.shift();
  }
  
  // Trim NO data
  while (state.noData.xs.length > 0 && state.noData.xs[0] < cutoff) {
    state.noData.xs.shift();
    state.noData.bid.shift();
    state.noData.mid.shift();
    state.noData.ask.shift();
    state.noData.impliedProb.shift();
  }
  
  // Also enforce max points as backup
  if (state.spotData.xs.length > MAX_POINTS) {
    const extra = state.spotData.xs.length - MAX_POINTS;
    state.spotData.xs.splice(0, extra);
    state.spotData.spot.splice(0, extra);
    state.spotData.strike.splice(0, extra);
  }
  if (state.yesData.xs.length > MAX_POINTS) {
    const extra = state.yesData.xs.length - MAX_POINTS;
    state.yesData.xs.splice(0, extra);
    state.yesData.bid.splice(0, extra);
    state.yesData.mid.splice(0, extra);
    state.yesData.ask.splice(0, extra);
    state.yesData.impliedProb.splice(0, extra);
  }
  if (state.noData.xs.length > MAX_POINTS) {
    const extra = state.noData.xs.length - MAX_POINTS;
    state.noData.xs.splice(0, extra);
    state.noData.bid.splice(0, extra);
    state.noData.mid.splice(0, extra);
    state.noData.ask.splice(0, extra);
    state.noData.impliedProb.splice(0, extra);
  }
  
  scheduleRender();
}

function scheduleRender() {
  if (renderScheduled) return;
  renderScheduled = true;
  requestAnimationFrame(() => {
    render();
    renderScheduled = false;
  });
}

function render() {
  renderSpotChart();
  renderYesOddsChart();
  renderNoOddsChart();
  renderBooks();
  renderTrades();
  renderFairValueDistances();
}

function renderSpotChart() {
  if (!spotChart) return;
  spotChart.data.labels = state.spotData.xs;
  spotChart.data.datasets[0].data = state.spotData.spot;
  spotChart.data.datasets[1].data = state.spotData.strike;
  spotChart.update('none');
}

function renderYesOddsChart() {
  if (!yesOddsChart) return;
  yesOddsChart.data.labels = state.yesData.xs;
  yesOddsChart.data.datasets[0].data = state.yesData.bid;
  yesOddsChart.data.datasets[1].data = state.yesData.mid;
  yesOddsChart.data.datasets[2].data = state.yesData.ask;
  yesOddsChart.data.datasets[3].data = state.yesData.impliedProb;
  
  // Update trade markers as point annotations
  const cutoff = new Date(Date.now() - CHART_WINDOW_MINUTES * 60 * 1000);
  const visibleTrades = state.yesTradeMarkers.filter(t => t.ts >= cutoff);
  
  yesOddsChart.options.plugins.annotation.annotations = visibleTrades.reduce((acc, trade, idx) => {
    acc[`yesTrade${idx}`] = {
      type: 'point',
      xValue: trade.ts,
      yValue: trade.price,
      backgroundColor: trade.side === 'BUY' ? 'rgba(63, 185, 80, 0.8)' : 'rgba(248, 81, 73, 0.8)',
      borderColor: trade.side === 'BUY' ? '#3fb950' : '#f85149',
      borderWidth: 2,
      radius: 6,
      pointStyle: trade.side === 'BUY' ? 'triangle' : 'triangleDown',
    };
    return acc;
  }, {});
  
  // Dynamic y-axis scaling
  const allValues = [
    ...state.yesData.bid.filter(v => v !== null),
    ...state.yesData.mid.filter(v => v !== null),
    ...state.yesData.ask.filter(v => v !== null),
    ...state.yesData.impliedProb.filter(v => v !== null),
  ];
  
  if (allValues.length > 0) {
    const min = Math.min(...allValues);
    const max = Math.max(...allValues);
    const padding = (max - min) * 0.1 || 0.05;
    
    yesOddsChart.options.scales.y.min = Math.max(0, min - padding);
    yesOddsChart.options.scales.y.max = Math.min(1, max + padding);
  }
  
  yesOddsChart.update('none');
}

function renderNoOddsChart() {
  if (!noOddsChart) return;
  noOddsChart.data.labels = state.noData.xs;
  noOddsChart.data.datasets[0].data = state.noData.bid;
  noOddsChart.data.datasets[1].data = state.noData.mid;
  noOddsChart.data.datasets[2].data = state.noData.ask;
  noOddsChart.data.datasets[3].data = state.noData.impliedProb;
  
  // Update trade markers as point annotations
  const cutoff = new Date(Date.now() - CHART_WINDOW_MINUTES * 60 * 1000);
  const visibleTrades = state.noTradeMarkers.filter(t => t.ts >= cutoff);
  
  noOddsChart.options.plugins.annotation.annotations = visibleTrades.reduce((acc, trade, idx) => {
    acc[`noTrade${idx}`] = {
      type: 'point',
      xValue: trade.ts,
      yValue: trade.price,
      backgroundColor: trade.side === 'BUY' ? 'rgba(63, 185, 80, 0.8)' : 'rgba(248, 81, 73, 0.8)',
      borderColor: trade.side === 'BUY' ? '#3fb950' : '#f85149',
      borderWidth: 2,
      radius: 6,
      pointStyle: trade.side === 'BUY' ? 'triangle' : 'triangleDown',
    };
    return acc;
  }, {});
  
  // Dynamic y-axis scaling
  const allValues = [
    ...state.noData.bid.filter(v => v !== null),
    ...state.noData.mid.filter(v => v !== null),
    ...state.noData.ask.filter(v => v !== null),
    ...state.noData.impliedProb.filter(v => v !== null),
  ];
  
  if (allValues.length > 0) {
    const min = Math.min(...allValues);
    const max = Math.max(...allValues);
    const padding = (max - min) * 0.1 || 0.05;
    
    noOddsChart.options.scales.y.min = Math.max(0, min - padding);
    noOddsChart.options.scales.y.max = Math.min(1, max + padding);
  }
  
  noOddsChart.update('none');
}

function renderBooks() {
  // YES market order book
  const yesBookBody = document.getElementById('yesBookBody');
  const yesBids = state.current.yes.bids || [];
  const yesAsks = state.current.yes.asks || [];
  
  const yesRows = [];
  const maxRows = Math.max(yesBids.length, yesAsks.length, 10);
  
  for (let i = 0; i < maxRows; i++) {
    const bid = yesBids[i];
    const ask = yesAsks[i];
    
    const bidSize = bid ? bid.size.toFixed(2) : '-';
    const bidPrice = bid ? (bid.price * 100).toFixed(2) : '-';
    const askPrice = ask ? (ask.price * 100).toFixed(2) : '-';
    const askSize = ask ? ask.size.toFixed(2) : '-';
    
    yesRows.push(`
      <tr>
        <td>${bidSize}</td>
        <td class="bid">${bidPrice}</td>
        <td class="ask">${askPrice}</td>
        <td>${askSize}</td>
      </tr>
    `);
  }
  
  yesBookBody.innerHTML = yesRows.join('');
  
  // NO market order book
  const noBookBody = document.getElementById('noBookBody');
  const noBids = state.current.no.bids || [];
  const noAsks = state.current.no.asks || [];
  
  const noRows = [];
  const maxNoRows = Math.max(noBids.length, noAsks.length, 10);
  
  for (let i = 0; i < maxNoRows; i++) {
    const bid = noBids[i];
    const ask = noAsks[i];
    
    const bidSize = bid ? bid.size.toFixed(2) : '-';
    const bidPrice = bid ? (bid.price * 100).toFixed(2) : '-';
    const askPrice = ask ? (ask.price * 100).toFixed(2) : '-';
    const askSize = ask ? ask.size.toFixed(2) : '-';
    
    noRows.push(`
      <tr>
        <td>${bidSize}</td>
        <td class="bid">${bidPrice}</td>
        <td class="ask">${askPrice}</td>
        <td>${askSize}</td>
      </tr>
    `);
  }
  
  noBookBody.innerHTML = noRows.join('');
}

function renderFairValueDistances() {
  const yesFairDist = document.getElementById('yesFairDist');
  const noFairDist = document.getElementById('noFairDist');
  
  if (yesFairDist && state.current.yesFairDist) {
    const { bidDist, askDist } = state.current.yesFairDist;
    if (bidDist !== null && askDist !== null) {
      yesFairDist.textContent = `[Bid: ${(bidDist * 100).toFixed(2)}% | Ask: ${(askDist * 100).toFixed(2)}%]`;
    } else {
      yesFairDist.textContent = '';
    }
  }
  
  if (noFairDist && state.current.noFairDist) {
    const { bidDist, askDist } = state.current.noFairDist;
    if (bidDist !== null && askDist !== null) {
      noFairDist.textContent = `[Bid: ${(bidDist * 100).toFixed(2)}% | Ask: ${(askDist * 100).toFixed(2)}%]`;
    } else {
      noFairDist.textContent = '';
    }
  }
}

function renderTrades() {
  const tradesBody = document.getElementById('tradesBody');
  
  // Combine YES and NO trades
  const allTrades = [
    ...(state.current.yes.trades || []).map(t => ({ ...t, market: 'YES' })),
    ...(state.current.no.trades || []).map(t => ({ ...t, market: 'NO' })),
  ].sort((a, b) => b.ts - a.ts); // Sort by timestamp descending
  
  if (allTrades.length === 0) {
    tradesBody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:#8b949e;">No trades yet</td></tr>';
    return;
  }
  
  const rows = allTrades.slice(0, 15).map(t => {
    const time = new Date(t.ts).toLocaleTimeString();
    const marketClass = t.market === 'YES' ? 'yes-market' : 'no-market';
    const price = t.price ? (t.price * 100).toFixed(2) : '-';
    const size = t.size ? t.size.toFixed(2) : '-';
    
    return `
      <tr>
        <td>${time}</td>
        <td class="${marketClass}">${t.market}</td>
        <td>${t.side || '-'}</td>
        <td>${price}</td>
        <td>${size}</td>
      </tr>
    `;
  });
  
  tradesBody.innerHTML = rows.join('');
}

function setupCharts() {
  const commonOptions = {
    responsive: true,
    maintainAspectRatio: false,
    animation: false,
    interaction: { mode: 'nearest', intersect: false },
    plugins: { legend: { labels: { color: '#c9d1d9', font: { size: 11 } } } },
  };
  
  // Spot chart
  const spotCtx = document.getElementById('spotChart').getContext('2d');
  spotChart = new Chart(spotCtx, {
    type: 'line',
    data: {
      labels: [],
      datasets: [
        { 
          label: 'Spot', 
          borderColor: '#58a6ff', 
          backgroundColor: 'rgba(88, 166, 255, 0.1)',
          data: [], 
          tension: 0.2,
          borderWidth: 2,
          pointRadius: 0,
        },
        { 
          label: 'Strike', 
          borderColor: '#f85149', 
          data: [], 
          tension: 0, 
          borderDash: [5, 5],
          borderWidth: 2,
          pointRadius: 0,
        },
      ],
    },
    options: {
      ...commonOptions,
      scales: {
        x: { 
          type: 'time', 
          ticks: { color: '#8b949e', font: { size: 10 } }, 
          grid: { color: '#30363d' },
        },
        y: { 
          ticks: { color: '#8b949e', font: { size: 10 } }, 
          grid: { color: '#30363d' },
        },
      },
    },
  });
  
  // YES odds chart
  const yesCtx = document.getElementById('yesOddsChart').getContext('2d');
  yesOddsChart = new Chart(yesCtx, {
    type: 'line',
    data: {
      labels: [],
      datasets: [
        { label: 'Bid', borderColor: '#3fb950', data: [], tension: 0.2, borderWidth: 1.5, pointRadius: 0 },
        { label: 'Mid', borderColor: '#58a6ff', data: [], tension: 0.2, borderWidth: 2, pointRadius: 0 },
        { label: 'Ask', borderColor: '#f85149', data: [], tension: 0.2, borderWidth: 1.5, pointRadius: 0 },
        { label: 'Implied', borderColor: '#d29922', data: [], tension: 0.2, borderDash: [3, 3], borderWidth: 2, pointRadius: 0 },
      ],
    },
    options: {
      ...commonOptions,
      plugins: {
        ...commonOptions.plugins,
        annotation: {
          annotations: {},
        },
      },
      scales: {
        x: { 
          type: 'time', 
          ticks: { color: '#8b949e', font: { size: 10 } }, 
          grid: { color: '#30363d' },
        },
        y: {
          min: 0,
          max: 1,
          ticks: { 
            color: '#8b949e', 
            font: { size: 10 },
            callback: (v) => (v * 100).toFixed(0) + '%',
          },
          grid: { color: '#30363d' },
        },
      },
    },
  });
  
  // NO odds chart
  const noCtx = document.getElementById('noOddsChart').getContext('2d');
  noOddsChart = new Chart(noCtx, {
    type: 'line',
    data: {
      labels: [],
      datasets: [
        { label: 'Bid', borderColor: '#3fb950', data: [], tension: 0.2, borderWidth: 1.5, pointRadius: 0 },
        { label: 'Mid', borderColor: '#58a6ff', data: [], tension: 0.2, borderWidth: 2, pointRadius: 0 },
        { label: 'Ask', borderColor: '#f85149', data: [], tension: 0.2, borderWidth: 1.5, pointRadius: 0 },
        { label: 'Implied', borderColor: '#d29922', data: [], tension: 0.2, borderDash: [3, 3], borderWidth: 2, pointRadius: 0 },
      ],
    },
    options: {
      ...commonOptions,
      plugins: {
        ...commonOptions.plugins,
        annotation: {
          annotations: {},
        },
      },
      scales: {
        x: { 
          type: 'time', 
          ticks: { color: '#8b949e', font: { size: 10 } }, 
          grid: { color: '#30363d' },
        },
        y: {
          min: 0,
          max: 1,
          ticks: { 
            color: '#8b949e', 
            font: { size: 10 },
            callback: (v) => (v * 100).toFixed(0) + '%',
          },
          grid: { color: '#30363d' },
        },
      },
    },
  });
}

// Event listeners
document.getElementById('startBtn').addEventListener('click', startAggregator);
document.getElementById('stopBtn').addEventListener('click', stopAggregator);

// Initialize
setupCharts();
connect();
