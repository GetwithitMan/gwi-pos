# 50 - Epson Printing (ePOS SDK)

**Status:** Planning
**Priority:** Critical (Infrastructure)
**Dependencies:** 34-Device-Management, 49-Unifi-Network

---

## Overview

The Epson Printing skill provides a clean, structured implementation for printing to Epson thermal printers using the ePOS SDK (JavaScript). Covers network discovery, connection management, print job queuing, error handling, and fallback mechanisms. Designed for reliability in high-volume environments.

**Primary Goal:** Reliable, fast printing to Epson thermal printers with clean code structure and robust error handling.

---

## User Stories

### As a Developer...
- I want a clean API for printing
- I want automatic reconnection on failure
- I want print job queuing and retry
- I want clear error messages

### As an Operator...
- I want prints to work reliably
- I want fallback when printer is busy
- I want clear status indicators
- I want easy troubleshooting

### As a Manager...
- I want visibility into print failures
- I want printer health monitoring
- I want configuration without code changes

---

## Features

### Supported Printers

#### Epson TM Series
```yaml
supported_models:
  receipt_printers:
    - model: "TM-T88VII"
      connection: "Ethernet, USB"
      paper_width: "80mm"
      recommended: true

    - model: "TM-T88VI"
      connection: "Ethernet, USB"
      paper_width: "80mm"

    - model: "TM-T82III"
      connection: "Ethernet, USB"
      paper_width: "80mm"

    - model: "TM-m30II"
      connection: "Ethernet, USB, Bluetooth"
      paper_width: "80mm"
      mobile: true

  kitchen_printers:
    - model: "TM-U220"
      connection: "Ethernet"
      paper_width: "76mm"
      impact: true  # Kitchen-rated

    - model: "TM-T70II"
      connection: "Ethernet"
      paper_width: "80mm"
```

### Connection Management

#### ePOS SDK Setup
```javascript
// printer-service.js - Core printer service

class PrinterService {
  constructor() {
    this.printers = new Map();
    this.printQueue = new Map();
    this.reconnectAttempts = new Map();
  }

  /**
   * Initialize connection to a printer
   * @param {string} printerId - Unique printer identifier
   * @param {string} ipAddress - Printer IP address
   * @param {number} port - ePOS port (default 8008)
   */
  async connect(printerId, ipAddress, port = 8008) {
    const deviceId = `local_printer_${printerId}`;

    // Create ePOS device
    const eposDevice = new epson.ePOSDevice();

    return new Promise((resolve, reject) => {
      eposDevice.connect(ipAddress, port, (status) => {
        if (status === 'OK') {
          this.createPrinter(eposDevice, printerId, deviceId)
            .then(resolve)
            .catch(reject);
        } else {
          reject(new PrinterConnectionError(printerId, status));
        }
      });
    });
  }

  /**
   * Create printer object after device connection
   */
  async createPrinter(eposDevice, printerId, deviceId) {
    return new Promise((resolve, reject) => {
      eposDevice.createDevice(
        deviceId,
        eposDevice.DEVICE_TYPE_PRINTER,
        { crypto: false, buffer: false },
        (device, code) => {
          if (code === 'OK') {
            this.printers.set(printerId, {
              device: device,
              eposDevice: eposDevice,
              status: 'connected',
              lastActivity: Date.now()
            });

            // Set up event listeners
            this.setupEventListeners(printerId, device);
            resolve({ printerId, status: 'connected' });
          } else {
            reject(new PrinterConnectionError(printerId, code));
          }
        }
      );
    });
  }

  /**
   * Set up printer event listeners
   */
  setupEventListeners(printerId, device) {
    device.onreceive = (response) => {
      this.handlePrintResponse(printerId, response);
    };

    device.onerror = (error) => {
      this.handlePrinterError(printerId, error);
    };

    device.onstatuschange = (status) => {
      this.handleStatusChange(printerId, status);
    };
  }
}
```

#### Connection Pool
```javascript
// connection-pool.js - Manage multiple printer connections

class PrinterConnectionPool {
  constructor(config) {
    this.config = config;
    this.printerService = new PrinterService();
    this.healthCheckInterval = null;
  }

  /**
   * Initialize all configured printers
   */
  async initializeAll(printers) {
    const results = await Promise.allSettled(
      printers.map(p => this.printerService.connect(p.id, p.ip, p.port))
    );

    return results.map((result, index) => ({
      printerId: printers[index].id,
      status: result.status === 'fulfilled' ? 'connected' : 'failed',
      error: result.status === 'rejected' ? result.reason.message : null
    }));
  }

  /**
   * Start health check polling
   */
  startHealthChecks(intervalMs = 30000) {
    this.healthCheckInterval = setInterval(() => {
      this.checkAllPrinters();
    }, intervalMs);
  }

  /**
   * Check all printer connections
   */
  async checkAllPrinters() {
    for (const [printerId, printer] of this.printerService.printers) {
      try {
        await this.pingPrinter(printerId);
      } catch (error) {
        this.handleOfflinePrinter(printerId);
      }
    }
  }
}
```

### Print Job Queue

#### Queue Implementation
```javascript
// print-queue.js - Print job queuing with retry

class PrintQueue {
  constructor(printerService) {
    this.printerService = printerService;
    this.queues = new Map(); // Per-printer queues
    this.processing = new Map();
    this.maxRetries = 3;
    this.retryDelayMs = 1000;
  }

  /**
   * Add job to print queue
   * @param {string} printerId - Target printer
   * @param {object} job - Print job definition
   * @param {string} priority - 'high', 'normal', 'low'
   */
  enqueue(printerId, job, priority = 'normal') {
    const jobId = generateUUID();
    const queuedJob = {
      id: jobId,
      printerId,
      job,
      priority,
      attempts: 0,
      createdAt: Date.now(),
      status: 'queued'
    };

    if (!this.queues.has(printerId)) {
      this.queues.set(printerId, []);
    }

    const queue = this.queues.get(printerId);

    // Insert based on priority
    if (priority === 'high') {
      queue.unshift(queuedJob);
    } else {
      queue.push(queuedJob);
    }

    this.processQueue(printerId);
    return jobId;
  }

  /**
   * Process queue for a printer
   */
  async processQueue(printerId) {
    if (this.processing.get(printerId)) return;

    const queue = this.queues.get(printerId);
    if (!queue || queue.length === 0) return;

    this.processing.set(printerId, true);
    const job = queue.shift();

    try {
      await this.executeJob(job);
      job.status = 'completed';
    } catch (error) {
      await this.handleJobError(job, error);
    } finally {
      this.processing.set(printerId, false);
      this.processQueue(printerId); // Process next
    }
  }

  /**
   * Handle job error with retry logic
   */
  async handleJobError(job, error) {
    job.attempts++;

    if (job.attempts < this.maxRetries) {
      job.status = 'retry';
      await sleep(this.retryDelayMs * job.attempts);
      this.queues.get(job.printerId).unshift(job); // Re-add to front
    } else {
      job.status = 'failed';
      job.error = error.message;
      this.notifyJobFailed(job);
    }
  }
}
```

### Print Builder

#### Receipt Builder Pattern
```javascript
// print-builder.js - Fluent API for building print jobs

class ReceiptBuilder {
  constructor(printer) {
    this.printer = printer;
    this.reset();
  }

  reset() {
    this.printer.addTextAlign(this.printer.ALIGN_LEFT);
    this.printer.addTextFont(this.printer.FONT_A);
    this.printer.addTextSize(1, 1);
    return this;
  }

  // Text formatting
  text(content) {
    this.printer.addText(content);
    return this;
  }

  line(content) {
    this.printer.addText(content + '\n');
    return this;
  }

  // Alignment
  left() {
    this.printer.addTextAlign(this.printer.ALIGN_LEFT);
    return this;
  }

  center() {
    this.printer.addTextAlign(this.printer.ALIGN_CENTER);
    return this;
  }

  right() {
    this.printer.addTextAlign(this.printer.ALIGN_RIGHT);
    return this;
  }

  // Text size
  size(width, height) {
    this.printer.addTextSize(width, height);
    return this;
  }

  normal() {
    return this.size(1, 1);
  }

  double() {
    return this.size(2, 2);
  }

  doubleHeight() {
    return this.size(1, 2);
  }

  doubleWidth() {
    return this.size(2, 1);
  }

  // Text style
  bold(enabled = true) {
    this.printer.addTextStyle(false, false, enabled, false);
    return this;
  }

  underline(enabled = true) {
    this.printer.addTextStyle(false, enabled, false, false);
    return this;
  }

  // Special elements
  feed(lines = 1) {
    this.printer.addFeedLine(lines);
    return this;
  }

  cut(type = 'feed') {
    if (type === 'feed') {
      this.printer.addCut(this.printer.CUT_FEED);
    } else {
      this.printer.addCut(this.printer.CUT_NO_FEED);
    }
    return this;
  }

  divider(char = '-', width = 48) {
    this.line(char.repeat(width));
    return this;
  }

  // Two-column layout
  columns(left, right, totalWidth = 48) {
    const gap = 2;
    const leftWidth = totalWidth - right.length - gap;
    const paddedLeft = left.substring(0, leftWidth).padEnd(leftWidth);
    this.line(paddedLeft + '  ' + right);
    return this;
  }

  // Barcode
  barcode(data, type = 'CODE128') {
    this.printer.addBarcode(data, this.printer[`BARCODE_${type}`],
      this.printer.HRI_BELOW, this.printer.FONT_A, 2, 64);
    return this;
  }

  // QR Code
  qrcode(data, size = 4) {
    this.printer.addSymbol(data, this.printer.SYMBOL_QRCODE_MODEL_2,
      this.printer.LEVEL_L, size, size, 0);
    return this;
  }

  // Cash drawer
  openDrawer() {
    this.printer.addPulse(this.printer.DRAWER_1, this.printer.PULSE_100);
    return this;
  }

  // Execute print
  async print() {
    return new Promise((resolve, reject) => {
      this.printer.send();
      // Handle via event listeners
    });
  }
}
```

#### Usage Example
```javascript
// Example: Building a receipt

async function printReceipt(printerId, order) {
  const printer = printerService.getPrinter(printerId);
  const builder = new ReceiptBuilder(printer);

  await builder
    // Header
    .center()
    .double()
    .line('GWI Restaurant')
    .normal()
    .line('123 Main Street')
    .line('City, State 12345')
    .line('(555) 123-4567')
    .feed()
    .divider('=')

    // Order info
    .left()
    .columns('Order #:', order.number)
    .columns('Server:', order.serverName)
    .columns('Date:', formatDate(order.createdAt))
    .columns('Table:', order.tableName || 'N/A')
    .divider('-')

    // Items
    .items(order.items.map(item => ({
      name: item.name,
      qty: item.quantity,
      price: formatMoney(item.total)
    })))

    // Totals
    .divider('-')
    .columns('Subtotal:', formatMoney(order.subtotal))
    .columns('Tax:', formatMoney(order.tax))
    .bold()
    .columns('TOTAL:', formatMoney(order.total))
    .bold(false)

    // Footer
    .feed()
    .center()
    .line('Thank you for dining with us!')
    .feed(3)
    .cut()
    .print();
}
```

### Kitchen Ticket Builder

```javascript
// kitchen-ticket-builder.js

class KitchenTicketBuilder extends ReceiptBuilder {

  header(order) {
    return this
      .center()
      .double()
      .bold()
      .line(`#${order.number}`)
      .normal()
      .bold(false)
      .line(order.orderType.toUpperCase())
      .line(order.tableName || order.customerName)
      .divider('=')
      .left();
  }

  item(item) {
    // Quantity and name
    this
      .doubleHeight()
      .bold()
      .line(`${item.quantity}x ${item.name}`)
      .normal()
      .bold(false);

    // Modifiers
    if (item.modifiers && item.modifiers.length > 0) {
      item.modifiers.forEach(mod => {
        this.line(`   → ${mod.name}`);
      });
    }

    // Special notes (highlighted)
    if (item.notes) {
      this
        .bold()
        .line(`   *** ${item.notes} ***`)
        .bold(false);
    }

    // Allergy warning (extra prominent)
    if (item.allergyNote) {
      this
        .feed()
        .center()
        .double()
        .bold()
        .line('⚠️ ALLERGY ⚠️')
        .line(item.allergyNote)
        .normal()
        .bold(false)
        .left()
        .feed();
    }

    return this;
  }

  items(items) {
    items.forEach((item, index) => {
      this.item(item);
      if (index < items.length - 1) {
        this.feed();
      }
    });
    return this;
  }

  footer(order) {
    return this
      .divider('=')
      .center()
      .line(`Sent: ${formatTime(order.sentAt)}`)
      .line(`Server: ${order.serverName}`)
      .feed(4)
      .cut();
  }
}
```

### Error Handling

#### Error Types
```javascript
// printer-errors.js

class PrinterError extends Error {
  constructor(printerId, message, code) {
    super(message);
    this.name = 'PrinterError';
    this.printerId = printerId;
    this.code = code;
    this.timestamp = Date.now();
  }
}

class PrinterConnectionError extends PrinterError {
  constructor(printerId, code) {
    const messages = {
      'ERROR_TIMEOUT': 'Connection timed out',
      'ERROR_PARAMETER': 'Invalid connection parameters',
      'ERROR_NOT_FOUND': 'Printer not found on network',
      'ERROR_SYSTEM': 'System error occurred'
    };
    super(printerId, messages[code] || `Connection failed: ${code}`, code);
    this.name = 'PrinterConnectionError';
  }
}

class PrinterOfflineError extends PrinterError {
  constructor(printerId) {
    super(printerId, 'Printer is offline', 'OFFLINE');
    this.name = 'PrinterOfflineError';
  }
}

class PrinterPaperError extends PrinterError {
  constructor(printerId, type) {
    const messages = {
      'OUT': 'Printer is out of paper',
      'NEAR_END': 'Paper is running low',
      'JAM': 'Paper jam detected'
    };
    super(printerId, messages[type] || 'Paper error', `PAPER_${type}`);
    this.name = 'PrinterPaperError';
  }
}

class PrinterCoverError extends PrinterError {
  constructor(printerId) {
    super(printerId, 'Printer cover is open', 'COVER_OPEN');
    this.name = 'PrinterCoverError';
  }
}
```

#### Error Handler
```javascript
// error-handler.js

class PrinterErrorHandler {

  handleStatusChange(printerId, status) {
    // Paper status
    if (status.paper === this.printer.PAPER_EMPTY) {
      throw new PrinterPaperError(printerId, 'OUT');
    }
    if (status.paper === this.printer.PAPER_NEAR_END) {
      this.notifyPaperLow(printerId);
    }

    // Cover status
    if (status.coverOpen) {
      throw new PrinterCoverError(printerId);
    }

    // Connection status
    if (status.connection === this.printer.FALSE) {
      throw new PrinterOfflineError(printerId);
    }
  }

  async handleError(printerId, error) {
    console.error(`Printer ${printerId} error:`, error);

    // Log to system
    await this.logPrinterError(printerId, error);

    // Notify appropriate parties
    if (error instanceof PrinterPaperError) {
      this.notifyStaff(printerId, 'Paper issue');
    } else if (error instanceof PrinterOfflineError) {
      this.attemptReconnect(printerId);
    }

    // Reroute if possible
    if (this.canReroute(printerId, error)) {
      return this.reroute(printerId);
    }

    throw error;
  }

  canReroute(printerId, error) {
    // Check if there's a backup printer
    const backup = this.getBackupPrinter(printerId);
    return backup && backup.isOnline();
  }

  async reroute(printerId) {
    const backup = this.getBackupPrinter(printerId);
    console.log(`Rerouting from ${printerId} to ${backup.id}`);
    return backup.id;
  }
}
```

---

## Port Configuration

### Standard Ports
```yaml
epson_ports:
  epos_sdk:
    http: 8008
    https: 8043
    websocket: 8008
    description: "ePOS SDK default ports"

  raw_printing:
    port: 9100
    description: "Direct RAW printing"

  line_printer:
    port: 515
    description: "LPD/LPR protocol"
```

### Network Configuration
```javascript
// config/printers.js

const printerConfig = {
  connectionTimeout: 5000,
  printTimeout: 30000,
  retryAttempts: 3,
  retryDelay: 1000,

  ports: {
    epos: 8008,
    eposSecure: 8043,
    raw: 9100
  },

  healthCheck: {
    enabled: true,
    intervalMs: 30000,
    offlineThresholdMs: 60000
  }
};
```

---

## Data Model

### Printer Registry
```sql
printers {
  id: UUID PRIMARY KEY
  location_id: UUID (FK)

  -- Identity
  name: VARCHAR(100)
  model: VARCHAR(100)
  serial_number: VARCHAR(100) (nullable)

  -- Network
  ip_address: INET
  port: INTEGER DEFAULT 8008
  mac_address: VARCHAR(17) (nullable)

  -- Type
  printer_type: VARCHAR(50) (receipt, kitchen, bar, label)
  paper_width: INTEGER DEFAULT 80 -- mm

  -- Status
  is_enabled: BOOLEAN DEFAULT true
  is_online: BOOLEAN DEFAULT false
  last_seen: TIMESTAMP (nullable)
  last_error: TEXT (nullable)

  -- Fallback
  backup_printer_id: UUID (FK, nullable)

  created_at: TIMESTAMP
  updated_at: TIMESTAMP
}
```

### Print Jobs Log
```sql
print_jobs {
  id: UUID PRIMARY KEY
  printer_id: UUID (FK)

  -- Job info
  job_type: VARCHAR(50) (receipt, kitchen_ticket, report)
  reference_type: VARCHAR(50) (order, void, report)
  reference_id: UUID (nullable)

  -- Status
  status: VARCHAR(50) (queued, printing, completed, failed)
  attempts: INTEGER DEFAULT 0

  -- Timing
  queued_at: TIMESTAMP
  started_at: TIMESTAMP (nullable)
  completed_at: TIMESTAMP (nullable)

  -- Error
  error_message: TEXT (nullable)
  error_code: VARCHAR(50) (nullable)

  -- Reroute
  rerouted_from: UUID (FK, nullable)
  rerouted_to: UUID (FK, nullable)
}
```

---

## API Endpoints

### Printer Management
```
GET    /api/printers
GET    /api/printers/{id}
POST   /api/printers
PUT    /api/printers/{id}
DELETE /api/printers/{id}
GET    /api/printers/{id}/status
POST   /api/printers/{id}/test
```

### Print Jobs
```
POST   /api/print/receipt
POST   /api/print/kitchen-ticket
POST   /api/print/report
GET    /api/print/queue/{printerId}
POST   /api/print/retry/{jobId}
DELETE /api/print/cancel/{jobId}
```

---

## Business Rules

1. **Connection Pooling:** Maintain persistent connections to all printers
2. **Auto-Reconnect:** Attempt reconnection on failure (3 attempts, exponential backoff)
3. **Job Queue:** Queue jobs when printer is busy, process FIFO with priority support
4. **Fallback Routing:** Route to backup printer if primary is offline
5. **Error Logging:** Log all errors with context for troubleshooting
6. **Health Monitoring:** Check printer status every 30 seconds

---

## Permissions

| Action | Server | Manager | Admin |
|--------|--------|---------|-------|
| Print receipts | Yes | Yes | Yes |
| View printer status | Yes | Yes | Yes |
| Configure printers | No | No | Yes |
| Test print | No | Yes | Yes |
| View error logs | No | Yes | Yes |

---

## Configuration Options

```yaml
printing:
  epson:
    default_port: 8008
    connection_timeout_ms: 5000
    print_timeout_ms: 30000

  queue:
    max_retries: 3
    retry_delay_ms: 1000
    max_queue_size: 100

  health_check:
    enabled: true
    interval_ms: 30000

  fallback:
    enabled: true
    auto_reroute: true
    notify_on_reroute: true

  logging:
    log_all_jobs: true
    log_errors: true
    retention_days: 30
```

---

*Last Updated: January 27, 2026*
