const net = require('net');
const EventEmitter = require('events');
const { AMI_BUFFER_MAX, AMI_ACTION_TIMEOUT, AMI_RECONNECT_BASE, AMI_RECONNECT_MAX } = require('../constants');

class AmiService extends EventEmitter {
  constructor() {
    super();
    this.socket = null;
    this.connected = false;
    this.loggedIn = false;
    this.buffer = '';
    this.actionId = 0;
    this.pendingActions = new Map();
    this.reconnectTimer = null;
    this.reconnectDelay = AMI_RECONNECT_BASE;
    this.bannerReceived = false;
  }

  connect() {
    const host = process.env.AMI_HOST || '127.0.0.1';
    const port = parseInt(process.env.AMI_PORT) || 5100;

    console.log(`AMI: Connecting to ${host}:${port}...`);

    this.bannerReceived = false;
    this.socket = new net.Socket();

    this.socket.connect(port, host, () => {
      console.log('AMI: TCP connection established');
      this.connected = true;
      // Reset backoff on successful connection
      this.reconnectDelay = AMI_RECONNECT_BASE;
    });

    this.socket.on('data', (data) => {
      this.buffer += data.toString();

      // Buffer overflow protection
      if (this.buffer.length > AMI_BUFFER_MAX) {
        console.error('AMI: Buffer overflow, resetting');
        this.buffer = '';
        return;
      }

      this._processBuffer();
    });

    this.socket.on('close', () => {
      console.log('AMI: Connection closed');
      this.connected = false;
      this.loggedIn = false;
      this.bannerReceived = false;
      this._scheduleReconnect();
    });

    this.socket.on('error', (err) => {
      console.error('AMI: Connection error:', err.message);
      this.connected = false;
      this.loggedIn = false;
    });
  }

  _scheduleReconnect() {
    if (this.reconnectTimer) return;
    console.log(`AMI: Reconnecting in ${this.reconnectDelay / 1000}s...`);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, this.reconnectDelay);

    // Exponential backoff: 5s → 10s → 20s → 40s → 60s (max)
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, AMI_RECONNECT_MAX);
  }

  _processBuffer() {
    if (!this.bannerReceived) {
      const bannerEnd = this.buffer.indexOf('\r\n');
      if (bannerEnd === -1) return;

      const banner = this.buffer.substring(0, bannerEnd);
      if (banner.startsWith('Asterisk Call Manager')) {
        console.log('AMI: Banner received:', banner.trim());
        this.bannerReceived = true;
        this.buffer = this.buffer.substring(bannerEnd + 2);
        this._login();
      }
    }

    const packets = this.buffer.split('\r\n\r\n');
    this.buffer = packets.pop() || '';

    for (const packet of packets) {
      if (!packet.trim()) continue;

      const parsed = this._parsePacket(packet);
      if (!parsed) continue;

      if (parsed.Response && parsed.ActionID) {
        const pending = this.pendingActions.get(parsed.ActionID);
        if (pending) {
          this.pendingActions.delete(parsed.ActionID);
          if (parsed.Response === 'Success') {
            pending.resolve(parsed);
          } else {
            pending.reject(new Error(parsed.Message || 'AMI action failed'));
          }
        }
      }

      if (parsed.Response === 'Success' && parsed.Message === 'Authentication accepted') {
        this.loggedIn = true;
        console.log('AMI: Logged in successfully');
        this.emit('ready');
      }

      if (parsed.Event) {
        this.emit('ami_event', parsed);
        this.emit(parsed.Event, parsed);
      }
    }
  }

  _parsePacket(packet) {
    const lines = packet.split('\r\n');
    const result = {};

    for (const line of lines) {
      const colonIndex = line.indexOf(':');
      if (colonIndex === -1) continue;
      const key = line.substring(0, colonIndex).trim();
      const value = line.substring(colonIndex + 1).trim();
      result[key] = value;
    }

    return Object.keys(result).length > 0 ? result : null;
  }

  _login() {
    const user = process.env.AMI_USER || 'webrtcc';
    const secret = process.env.AMI_PASSWORD || '';

    this._sendRaw(
      `Action: Login\r\nUsername: ${user}\r\nSecret: ${secret}\r\n\r\n`
    );
  }

  _sendRaw(data) {
    if (this.socket && this.connected) {
      this.socket.write(data);
    }
  }

  sendAction(action, params = {}) {
    return new Promise((resolve, reject) => {
      if (!this.connected || !this.loggedIn) {
        return reject(new Error('AMI not connected'));
      }

      const actionId = `pekepbxbc_${++this.actionId}`;
      let packet = `Action: ${action}\r\nActionID: ${actionId}\r\n`;

      for (const [key, value] of Object.entries(params)) {
        packet += `${key}: ${value}\r\n`;
      }
      packet += '\r\n';

      this.pendingActions.set(actionId, { resolve, reject });

      setTimeout(() => {
        if (this.pendingActions.has(actionId)) {
          this.pendingActions.delete(actionId);
          reject(new Error('AMI action timeout'));
        }
      }, AMI_ACTION_TIMEOUT);

      this._sendRaw(packet);
    });
  }

  disconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.socket) {
      this.sendAction('Logoff').catch(() => {});
      this.socket.destroy();
      this.socket = null;
    }
    this.connected = false;
    this.loggedIn = false;
  }
}

const amiService = new AmiService();
module.exports = amiService;
