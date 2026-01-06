// server.js
// Express server with WebSocket aggregation layer

import 'dotenv/config.js';
import express from 'express';
import { WebSocketServer } from 'ws';
import path from 'path';
import { fileURLToPath } from 'url';
import { Aggregator } from './services/aggregator.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 8900);
const app = express();

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// Create HTTP server
const server = app.listen(PORT, () => {
  console.log(`[Server] Trader Dashboard listening on http://localhost:${PORT}`);
});

// WebSocket server
const wss = new WebSocketServer({ server, path: '/stream' });

let currentAggregator = null;

function broadcast(obj) {
  const msg = JSON.stringify(obj);
  for (const client of wss.clients) {
    if (client.readyState === 1) {
      try {
        client.send(msg);
      } catch (err) {
        console.error('[WS] Send error:', err.message);
      }
    }
  }
}

// REST API endpoints
app.get('/api/config', (req, res) => {
  res.json({
    version: '1.0.0',
    port: PORT,
    status: currentAggregator ? currentAggregator.getStatus() : 'idle',
  });
});

app.get('/api/markets/:slug', async (req, res) => {
  try {
    const agg = new Aggregator();
    const market = await agg.fetchMarketMetadata(req.params.slug);
    res.json({ success: true, market });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get('/api/history', (req, res) => {
  try {
    if (!currentAggregator) {
      return res.json({ success: true, history: [], message: 'No active aggregator' });
    }
    const minutes = parseInt(req.query.minutes) || 30;
    const history = currentAggregator.getHistory(minutes);
    res.json({ success: true, history, count: history.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/expiries', async (req, res) => {
  try {
    if (!currentAggregator) {
      return res.json({ success: false, error: 'No active aggregator', expiries: [] });
    }
    const expiries = await currentAggregator.getAvailableExpiries();
    res.json({ success: true, expiries });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message, expiries: [] });
  }
});

// WebSocket handler
wss.on('connection', (ws) => {
  console.log('[WS] Client connected');
  ws.send(JSON.stringify({ type: 'hello', port: PORT }));

  ws.on('message', async (msg) => {
    try {
      const cmd = JSON.parse(msg.toString());
      
      if (cmd.action === 'start') {
        const { slug = '', asset = 'ETH', assetIds = [] } = cmd;
        
        if (!slug) {
          ws.send(JSON.stringify({ type: 'error', error: 'slug is required' }));
          return;
        }

        // Stop previous aggregator
        if (currentAggregator) {
          currentAggregator.stop();
          currentAggregator = null;
        }

        // Create new aggregator
        currentAggregator = new Aggregator({
          onTick: (tick) => broadcast({ type: 'tick', data: tick }),
          onError: (err) => broadcast({ type: 'error', error: err }),
        });

        try {
          await currentAggregator.start(slug, asset, assetIds);
          broadcast({ type: 'status', status: 'started', slug, asset });
          console.log(`[Aggregator] Started for slug=${slug}, asset=${asset}`);
        } catch (err) {
          broadcast({ type: 'error', error: err.message });
          currentAggregator.stop();
          currentAggregator = null;
        }
      } else if (cmd.action === 'stop') {
        if (currentAggregator) {
          currentAggregator.stop();
          currentAggregator = null;
        }
        broadcast({ type: 'status', status: 'stopped' });
        console.log('[Aggregator] Stopped');
      } else if (cmd.action === 'status') {
        const status = currentAggregator ? currentAggregator.getStatus() : { status: 'idle' };
        ws.send(JSON.stringify({ type: 'status', data: status }));
      } else {
        ws.send(JSON.stringify({ type: 'error', error: 'unknown action' }));
      }
    } catch (err) {
      console.error('[WS] Message error:', err);
      ws.send(JSON.stringify({ type: 'error', error: err.message }));
    }
  });

  ws.on('close', () => {
    console.log('[WS] Client disconnected');
  });

  ws.on('error', (err) => {
    console.error('[WS] Error:', err.message);
  });
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('[Server] Shutting down...');
  if (currentAggregator) currentAggregator.stop();
  server.close(() => {
    console.log('[Server] Closed');
    process.exit(0);
  });
});

process.on('SIGTERM', () => {
  console.log('[Server] SIGTERM received');
  if (currentAggregator) currentAggregator.stop();
  server.close(() => process.exit(0));
});

export { app, server, wss };
