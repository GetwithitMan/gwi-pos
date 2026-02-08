# 44 - Performance & Speed Optimization

**Status:** Planning
**Priority:** Critical
**Dependencies:** ALL SKILLS

---

## Overview

The Performance skill defines the speed and responsiveness requirements for the entire POS system. Every interaction must be instant - "click bam, click bam." This skill establishes benchmarks, testing protocols, optimization strategies, and monitoring to ensure the system never feels slow.

**Primary Goal:** Sub-100ms response times for all user interactions. The fastest POS system in the market.

---

## Performance Philosophy

### Core Principles

```
1. INSTANT FEEDBACK
   Every tap must acknowledge within 50ms
   Visual feedback before processing completes

2. OPTIMISTIC UI
   Show success immediately
   Handle failures gracefully in background

3. PREFETCH EVERYTHING
   Anticipate next actions
   Cache aggressively

4. LAZY LOAD WISELY
   Critical path must be instant
   Non-critical can load progressively

5. MEASURE CONSTANTLY
   What gets measured gets improved
   Real-world metrics, not lab conditions
```

---

## Performance Targets

### Response Time Benchmarks

| Action | Target | Maximum | Critical |
|--------|--------|---------|----------|
| Button tap feedback | 16ms | 50ms | 100ms |
| Add item to order | 50ms | 100ms | 200ms |
| Open order/tab | 100ms | 200ms | 500ms |
| Navigate categories | 50ms | 100ms | 200ms |
| Search results | 100ms | 200ms | 500ms |
| Apply modifier | 50ms | 100ms | 200ms |
| Calculate total | 16ms | 50ms | 100ms |
| Print ticket | 200ms | 500ms | 1000ms |
| Process payment | 500ms | 1000ms | 2000ms |
| Generate report | 1000ms | 3000ms | 5000ms |

### Load Benchmarks

| Metric | Target | Minimum |
|--------|--------|---------|
| Initial load (cached) | < 2s | < 4s |
| Initial load (fresh) | < 4s | < 8s |
| Memory usage | < 200MB | < 500MB |
| Concurrent orders | 100+ | 50+ |
| Items per order | 500+ | 100+ |

---

## Optimization Strategies

### Frontend Optimizations

#### Instant Visual Feedback
```javascript
// Every button must respond immediately
const handleButtonPress = (item) => {
  // 1. Immediate visual feedback (< 16ms)
  setButtonPressed(true);
  playTapSound();

  // 2. Optimistic UI update (< 50ms)
  optimisticallyAddItem(item);

  // 3. Background processing
  queueBackgroundSync(item);

  // 4. Handle any errors gracefully
  // (rarely needed due to local-first architecture)
};
```

#### Preloading Strategy
```yaml
preload:
  on_login:
    - menu_items
    - categories
    - modifiers
    - employee_permissions
    - open_orders

  on_category_view:
    - adjacent_categories
    - frequent_items

  on_order_open:
    - customer_history
    - recent_modifiers
```

#### Code Splitting
- [ ] Route-based splitting
- [ ] Feature-based lazy loading
- [ ] Critical CSS inline
- [ ] Non-critical deferred

### Data Architecture

#### Local-First Design
```
User Action → Local State → UI Update → Background Sync
                              ↓
                    (Instant feedback)
```

#### Caching Layers
```
1. Memory Cache (instant)
   - Current order
   - Active menu
   - Session data

2. IndexedDB (< 10ms)
   - Full menu
   - Order history
   - Customer data

3. Local Server (< 50ms)
   - Shared state
   - Real-time sync

4. Cloud (variable)
   - Source of truth
   - Analytics
   - Backup
```

#### Database Optimization
```sql
-- Essential indexes for speed
CREATE INDEX idx_menu_items_category ON menu_items(category_id) WHERE is_active = true;
CREATE INDEX idx_orders_open ON orders(status, location_id) WHERE status IN ('open', 'in_progress');
CREATE INDEX idx_order_items_order ON order_items(order_id);
CREATE INDEX idx_modifiers_item ON item_modifiers(menu_item_id) WHERE is_active = true;

-- Materialized views for complex queries
CREATE MATERIALIZED VIEW mv_menu_with_modifiers AS
SELECT ... (pre-joined menu data)
REFRESH MATERIALIZED VIEW CONCURRENTLY mv_menu_with_modifiers;
```

### Network Optimization

#### Request Minimization
- [ ] Batch API requests
- [ ] GraphQL for precise data fetching
- [ ] WebSocket for real-time updates
- [ ] HTTP/2 multiplexing

#### Payload Optimization
- [ ] Gzip/Brotli compression
- [ ] Binary protocols where applicable
- [ ] Delta updates (send only changes)
- [ ] Pagination for large lists

### Rendering Optimization

#### Virtual Lists
- [ ] Only render visible items
- [ ] Recycled DOM elements
- [ ] Smooth scrolling at 60fps

#### Animation Performance
- [ ] CSS transforms only
- [ ] GPU acceleration
- [ ] will-change hints
- [ ] Reduced motion support

---

## Testing Protocol

### Automated Performance Tests

#### Continuous Benchmarking
```yaml
performance_tests:
  - name: "Add Item Speed"
    action: "add_item_to_order"
    iterations: 100
    target_p95: "100ms"
    fail_threshold: "200ms"

  - name: "Category Navigation"
    action: "switch_category"
    iterations: 50
    target_p95: "100ms"
    fail_threshold: "200ms"

  - name: "Order Load"
    action: "load_order_with_50_items"
    iterations: 20
    target_p95: "300ms"
    fail_threshold: "500ms"

  - name: "Search Response"
    action: "search_menu_items"
    iterations: 50
    target_p95: "200ms"
    fail_threshold: "500ms"
```

#### Load Testing
```yaml
load_tests:
  - name: "Peak Hour Simulation"
    concurrent_users: 20
    duration: "30 minutes"
    actions_per_minute: 100
    success_rate_threshold: "99.9%"

  - name: "Stress Test"
    concurrent_users: 50
    duration: "10 minutes"
    actions_per_minute: 200
    degrade_gracefully: true
```

### Manual Testing Checklist

#### Daily Speed Checks
- [ ] Login to POS (< 3s)
- [ ] Open new order (< 100ms)
- [ ] Add 10 items rapidly (no lag)
- [ ] Switch between 5 categories (smooth)
- [ ] Search for item (< 200ms)
- [ ] Apply modifier (instant)
- [ ] Split check (< 500ms)
- [ ] Process payment (< 2s)

### Real-World Monitoring

#### Metrics Collection
```yaml
metrics:
  client_side:
    - first_contentful_paint
    - time_to_interactive
    - input_latency
    - frame_rate
    - memory_usage

  server_side:
    - request_latency_p50
    - request_latency_p95
    - request_latency_p99
    - error_rate
    - throughput

  business:
    - order_completion_time
    - items_per_minute
    - checkout_duration
```

---

## UI/UX Specifications

### Performance Dashboard (Admin)

```
+------------------------------------------------------------------+
| SYSTEM PERFORMANCE                               Last 24 Hours    |
+------------------------------------------------------------------+
|                                                                   |
| RESPONSE TIMES                                                    |
| +------------------+ +------------------+ +------------------+    |
| | Avg Response     | | P95 Response     | | P99 Response     |    |
| | 45ms ✓           | | 89ms ✓           | | 156ms ✓          |    |
| | Target: <100ms   | | Target: <150ms   | | Target: <300ms   |    |
| +------------------+ +------------------+ +------------------+    |
|                                                                   |
| RESPONSE TIME TREND                                               |
| 100ms ┤                                                          |
|       │    ╭─╮                                                   |
|  50ms ┤───╯  ╰──────────────────────────────────────────        |
|       │                                                          |
|   0ms ┼──────────────────────────────────────────────────       |
|       12AM    6AM     12PM    6PM     12AM                       |
|                                                                   |
| BY OPERATION                                                      |
| +--------------------------------------------------------------+ |
| | Operation           | Avg    | P95    | Count   | Status     | |
| +--------------------------------------------------------------+ |
| | Add Item            | 42ms   | 78ms   | 12,456  | ✓ Good     | |
| | Open Order          | 67ms   | 134ms  | 1,234   | ✓ Good     | |
| | Switch Category     | 31ms   | 56ms   | 8,901   | ✓ Good     | |
| | Process Payment     | 890ms  | 1.2s   | 456     | ✓ Good     | |
| | Generate Report     | 2.1s   | 4.5s   | 23      | ⚠️ Watch    | |
| +--------------------------------------------------------------+ |
|                                                                   |
| SYSTEM HEALTH                                                     |
| CPU: 23% | Memory: 156MB/200MB | Network: 12ms latency          |
|                                                                   |
| [View Details]  [Export Metrics]  [Set Alerts]                   |
+------------------------------------------------------------------+
```

### Slow Operation Alert

```
+------------------------------------------------------------------+
| ⚠️ PERFORMANCE ALERT                                              |
+------------------------------------------------------------------+
|                                                                   |
| Detected slow operations in the last hour:                       |
|                                                                   |
| • "Generate Sales Report" averaging 4.5s (target: <3s)           |
|   - Recommendation: Add index on orders.created_at               |
|                                                                   |
| • "Load Order #4567" took 2.1s (target: <500ms)                  |
|   - Cause: Order has 234 items                                   |
|   - Recommendation: Implement pagination                         |
|                                                                   |
| [Dismiss]  [View All Alerts]  [Auto-Optimize]                    |
+------------------------------------------------------------------+
```

---

## Implementation Checklist

### Phase 1: Foundation
- [ ] Establish benchmark suite
- [ ] Set up monitoring infrastructure
- [ ] Define performance budgets
- [ ] Create optimization playbook

### Phase 2: Core Optimizations
- [ ] Implement local-first architecture
- [ ] Add IndexedDB caching layer
- [ ] Optimize database queries
- [ ] Enable code splitting

### Phase 3: Advanced Optimizations
- [ ] Virtual list rendering
- [ ] Predictive prefetching
- [ ] WebSocket real-time updates
- [ ] Service worker caching

### Phase 4: Continuous Improvement
- [ ] Automated regression testing
- [ ] Real-user monitoring
- [ ] A/B test optimizations
- [ ] Regular performance audits

---

## Anti-Patterns to Avoid

### ❌ Don't Do This

```javascript
// BAD: Blocking UI for network
const addItem = async (item) => {
  await saveToServer(item);  // User waits!
  updateUI(item);
};

// BAD: Loading everything upfront
const loadMenu = async () => {
  const allItems = await fetchAllMenuItems();  // 10,000 items!
  const allModifiers = await fetchAllModifiers();
  const allPrices = await fetchAllPrices();
  // ...minutes later...
};

// BAD: Re-rendering entire list
const updateOrder = (newItem) => {
  setOrderItems([...orderItems, newItem]);  // Re-renders all items!
};
```

### ✓ Do This Instead

```javascript
// GOOD: Optimistic UI
const addItem = (item) => {
  updateUI(item);  // Instant!
  queueSync(item);  // Background
};

// GOOD: Progressive loading
const loadMenu = async () => {
  const criticalItems = await fetchFastBarItems();  // 20 items, instant
  renderInitialUI();
  // Load rest in background
  prefetchRemainingItems();
};

// GOOD: Efficient updates
const updateOrder = (newItem) => {
  appendItem(newItem);  // Only new item renders
};
```

---

## Configuration

```yaml
performance:
  targets:
    response_time_avg_ms: 50
    response_time_p95_ms: 150
    response_time_p99_ms: 300

  caching:
    menu_cache_minutes: 60
    order_cache_minutes: 5
    prefetch_adjacent: true

  monitoring:
    sample_rate: 0.1  # 10% of requests
    alert_threshold_ms: 500
    alert_channels: ["slack", "email"]

  optimization:
    virtual_lists: true
    lazy_load_images: true
    compress_payloads: true
    use_web_workers: true
```

---

## Success Metrics

| Metric | Definition | Target |
|--------|------------|--------|
| Speed Score | Lighthouse performance score | > 95 |
| TTFB | Time to first byte | < 100ms |
| FCP | First contentful paint | < 1s |
| TTI | Time to interactive | < 2s |
| Input Latency | Time from tap to response | < 50ms |
| Frame Rate | UI animation smoothness | 60fps |
| Error Rate | Failed operations | < 0.1% |

---

*Last Updated: January 27, 2026*

**Remember: Speed is a feature. The fastest POS wins.**
