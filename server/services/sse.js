const { SSE_HEARTBEAT_INTERVAL } = require('../constants');

/**
 * SSE Connection Manager (Simplified)
 * Manages Server-Sent Events connections per user
 */

class SseManager {
  constructor() {
    this.clients = new Map(); // userId -> { extension, sipPeer, tenantId, role, connections: Set<res> }
    this._startHeartbeat();
  }

  addClient(userId, extension, tenantId, res, sipPeer, role) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no'
    });

    res.write(`event: connected\ndata: ${JSON.stringify({ userId, extension })}\n\n`);

    if (!this.clients.has(userId)) {
      this.clients.set(userId, { extension, sipPeer, tenantId, role, connections: new Set() });
    }
    this.clients.get(userId).connections.add(res);

    console.log(`SSE: Client connected (userId: ${userId}, ext: ${extension}, peer: ${sipPeer || 'N/A'}, role: ${role}, total: ${this._totalClients()})`);
    this._broadcastExtensionsUpdate();

    res.on('close', () => {
      const client = this.clients.get(userId);
      if (client) {
        client.connections.delete(res);
        if (client.connections.size === 0) {
          this.clients.delete(userId);
        }
      }
      console.log(`SSE: Client disconnected (userId: ${userId}, total: ${this._totalClients()})`);
      this._broadcastExtensionsUpdate();
    });
  }

  sendToUser(userId, event, data) {
    const client = this.clients.get(String(userId));
    if (!client) return;

    const message = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const res of client.connections) {
      res.write(message);
    }
  }

  // Send to matching sipPeer + all admins in same tenant
  sendToSipPeer(sipPeer, event, data, tenantId) {
    const message = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const [, client] of this.clients) {
      const isPeerMatch = sipPeer && client.sipPeer === sipPeer;
      const isAdminSameTenant = client.role === 'admin' && tenantId && client.tenantId === tenantId;
      if (isPeerMatch || isAdminSameTenant) {
        for (const res of client.connections) {
          res.write(message);
        }
      }
    }
  }

  broadcast(event, data) {
    const message = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const [, client] of this.clients) {
      for (const res of client.connections) {
        res.write(message);
      }
    }
  }

  getConnectedClients(tenantId) {
    const result = [];
    for (const [userId, client] of this.clients) {
      if (!client.extension) continue;
      if (tenantId && client.tenantId !== tenantId) continue;
      result.push({
        userId,
        extension: client.extension,
        sipPeer: client.sipPeer,
        tenantId: client.tenantId,
        role: client.role,
        connections: client.connections.size
      });
    }
    return result;
  }

  _broadcastExtensionsUpdate() {
    for (const [, client] of this.clients) {
      if (client.role !== 'admin' || !client.tenantId) continue;
      const extensions = this.getConnectedClients(client.tenantId);
      const message = `event: extensions_update\ndata: ${JSON.stringify(extensions)}\n\n`;
      for (const res of client.connections) {
        res.write(message);
      }
    }
  }

  _totalClients() {
    let total = 0;
    for (const [, client] of this.clients) {
      total += client.connections.size;
    }
    return total;
  }

  _startHeartbeat() {
    setInterval(() => {
      for (const [, client] of this.clients) {
        for (const res of client.connections) {
          res.write(':heartbeat\n\n');
        }
      }
    }, SSE_HEARTBEAT_INTERVAL);
  }
}

const sseManager = new SseManager();
module.exports = sseManager;
