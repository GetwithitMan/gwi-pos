# 21 - Staff Training

**Status:** Planning
**Priority:** Medium
**Dependencies:** 02-Operator-Experience, 05-Employees-Roles

---

## Overview

The Staff Training skill provides a safe environment for new employees to learn the POS system without affecting real operations. Includes training mode, guided tutorials, skill assessments, and progress tracking.

**Primary Goal:** Reduce training time and errors by providing an interactive, risk-free learning environment.

---

## User Stories

### As a New Employee...
- I want to practice taking orders without affecting real data
- I want guided tutorials for common tasks
- I want to make mistakes without consequences
- I want to track my progress and know when I'm ready

### As a Manager...
- I want to assign training to new hires
- I want to see training progress
- I want to certify employees before they go live
- I want to identify who needs additional training

### As an Owner...
- I want reduced training costs
- I want faster onboarding
- I want fewer errors from new staff

---

## Features

### Training Mode

#### Sandbox Environment
- [ ] Separate training data (fake orders, tables)
- [ ] No impact on real operations
- [ ] Full POS functionality available
- [ ] Clearly marked as "TRAINING MODE"

#### Training Mode Access
- [ ] Toggle via settings/manager
- [ ] Auto-login for training terminals
- [ ] Time-limited training sessions
- [ ] Exit requires PIN

#### Visual Indicators
- [ ] Distinct color scheme (yellow border?)
- [ ] "TRAINING MODE" watermark
- [ ] Cannot process real payments
- [ ] Cannot print real tickets

### Guided Tutorials

#### Tutorial Library
```yaml
tutorials:
  basics:
    - "Logging In"
    - "Navigating the POS"
    - "Understanding the Menu"

  orders:
    - "Starting a New Order"
    - "Adding Items"
    - "Using Modifiers"
    - "Sending to Kitchen"

  payments:
    - "Processing Cash Payment"
    - "Processing Card Payment"
    - "Splitting Checks"
    - "Applying Discounts"

  tables:
    - "Using the Floor Plan"
    - "Seating Guests"
    - "Transferring Tables"

  bar:
    - "Opening a Tab"
    - "Managing Tabs"
    - "Closing Tabs"

  advanced:
    - "Course Management"
    - "Hold and Fire"
    - "Voids and Comps"
```

#### Tutorial Format
- [ ] Step-by-step instructions
- [ ] Highlighted UI elements
- [ ] Practice exercises
- [ ] Completion confirmation

### Skill Assessments

#### Assessment Types
- [ ] **Quiz:** Multiple choice questions
- [ ] **Simulation:** Perform task in training mode
- [ ] **Timed Challenge:** Complete tasks under time pressure

#### Scoring
- [ ] Pass/fail thresholds
- [ ] Points/percentage
- [ ] Retry attempts
- [ ] Time tracking

#### Certification
- [ ] Required assessments by role
- [ ] Certification upon completion
- [ ] Recertification schedule
- [ ] Digital certificates

### Progress Tracking

#### Employee Dashboard
- [ ] Assigned training modules
- [ ] Completed modules
- [ ] Assessment scores
- [ ] Time spent training

#### Manager Dashboard
- [ ] All employees' progress
- [ ] Completion rates
- [ ] Struggling areas
- [ ] Certification status

### Training Scenarios

#### Pre-Built Scenarios
```yaml
scenarios:
  - name: "Lunch Rush"
    description: "Handle 5 tables during busy lunch service"
    tables: 5
    orders_per_table: 2-4
    time_limit: 20 minutes

  - name: "Complex Order"
    description: "Take an order with many modifications"
    focus: "modifiers"
    complexity: "high"

  - name: "Split Check Challenge"
    description: "Split a 6-person check by seat"
    focus: "splitting"
    guests: 6

  - name: "Happy Hour Chaos"
    description: "Manage bar tabs during happy hour"
    tabs: 8
    time_limit: 15 minutes
```

#### Custom Scenarios
- [ ] Manager creates scenarios
- [ ] Set parameters and goals
- [ ] Assign to employees

### Error Feedback

#### Real-Time Feedback
- [ ] Hints when stuck
- [ ] Error explanations
- [ ] Suggested corrections
- [ ] Best practice tips

#### Post-Session Review
- [ ] Summary of actions
- [ ] Errors highlighted
- [ ] Time analysis
- [ ] Improvement suggestions

---

## UI/UX Specifications

### Training Mode Banner

```
+------------------------------------------------------------------+
| ⚠️ TRAINING MODE - Actions do not affect real operations         |
+------------------------------------------------------------------+
|                                                                  |
|                    [Normal POS Interface]                        |
|                                                                  |
+------------------------------------------------------------------+
| Training: "Taking Orders"          Progress: 3/5  [Exit Training]|
+------------------------------------------------------------------+
```

### Tutorial Overlay

```
+------------------------------------------------------------------+
| TUTORIAL: Adding Items to an Order                    Step 3/5   |
+------------------------------------------------------------------+
|                                                                  |
|  +-----------------------------------------------------------+  |
|  | 👆 CLICK HERE                                              |  |
|  |                                                            |  |
|  | Now tap on "Cheeseburger" to add it to the order.         |  |
|  |                                                            |  |
|  | The item will appear in the order panel on the left.      |  |
|  |                                                            |  |
|  +-----------------------------------------------------------+  |
|                                                                  |
|  [◄ Previous]              [Skip]              [I did it! ►]    |
|                                                                  |
+------------------------------------------------------------------+

[POS Interface Below - "Cheeseburger" button highlighted/pulsing]
```

### Training Progress Dashboard

```
+------------------------------------------------------------------+
| TRAINING PROGRESS - Sarah Miller                                 |
+------------------------------------------------------------------+
|                                                                  |
| ASSIGNED TRAINING                              Due: Jan 30, 2026 |
| +-------------------------------------------------------------+ |
| | Module                | Status     | Score   | Time         | |
| +-------------------------------------------------------------+ |
| | Basics - Logging In   | ✓ Complete | 100%    | 5 min        | |
| | Basics - Navigation   | ✓ Complete | 95%     | 8 min        | |
| | Orders - New Order    | ✓ Complete | 90%     | 12 min       | |
| | Orders - Modifiers    | ◐ In Progress |      | 6 min        | |
| | Payments - Cash       | ○ Not Started |       |              | |
| | Payments - Card       | ○ Not Started |       |              | |
| | Assessment - Basic    | 🔒 Locked   |         |              | |
| +-------------------------------------------------------------+ |
|                                                                  |
| OVERALL PROGRESS                                                 |
| ████████████████░░░░░░░░░░░░░░░░ 42% Complete                   |
|                                                                  |
| [Continue Training]              [View Certificate Requirements] |
+------------------------------------------------------------------+
```

### Manager Training Overview

```
+------------------------------------------------------------------+
| TRAINING OVERVIEW                                                |
+------------------------------------------------------------------+
| Filter: [All Employees ▼] [All Modules ▼]                       |
+------------------------------------------------------------------+
|                                                                  |
| EMPLOYEE STATUS                                                  |
| +-------------------------------------------------------------+ |
| | Employee     | Assigned | Complete | In Progress | Certified | |
| +-------------------------------------------------------------+ |
| | Sarah Miller | 8        | 3        | 1           | No        | |
| | Mike Johnson | 8        | 8        | 0           | Yes ✓     | |
| | Lisa Garcia  | 5        | 2        | 2           | No        | |
| | New Hire Tom | 10       | 0        | 1           | No        | |
| +-------------------------------------------------------------+ |
|                                                                  |
| COMMON STRUGGLES                                                 |
| • Modifiers - 3 employees scoring below 80%                     |
| • Split Checks - Average 2.5 attempts to pass                   |
|                                                                  |
| [Assign Training]     [View Reports]     [Create Scenario]      |
+------------------------------------------------------------------+
```

---

## Data Model

### Training Modules
```sql
training_modules {
  id: UUID PRIMARY KEY
  location_id: UUID (FK, nullable) -- NULL = system-wide

  name: VARCHAR(200)
  description: TEXT
  category: VARCHAR(100)

  -- Content
  content_type: VARCHAR(50) (tutorial, quiz, simulation, scenario)
  content_data: JSONB -- Steps, questions, parameters

  -- Requirements
  estimated_duration_minutes: INTEGER
  passing_score: INTEGER (nullable) -- For quizzes/assessments
  max_attempts: INTEGER (nullable)

  -- Prerequisites
  prerequisite_module_ids: UUID[]

  -- Organization
  sort_order: INTEGER
  is_active: BOOLEAN DEFAULT true

  created_at: TIMESTAMP
  updated_at: TIMESTAMP
}
```

### Training Assignments
```sql
training_assignments {
  id: UUID PRIMARY KEY
  employee_id: UUID (FK)
  module_id: UUID (FK)

  assigned_by: UUID (FK)
  assigned_at: TIMESTAMP
  due_date: DATE (nullable)

  -- Status
  status: VARCHAR(50) (assigned, in_progress, completed, failed)
  started_at: TIMESTAMP (nullable)
  completed_at: TIMESTAMP (nullable)

  -- Results
  score: INTEGER (nullable)
  attempts: INTEGER DEFAULT 0
  time_spent_minutes: INTEGER DEFAULT 0

  created_at: TIMESTAMP
  updated_at: TIMESTAMP

  UNIQUE (employee_id, module_id)
}
```

### Training Sessions
```sql
training_sessions {
  id: UUID PRIMARY KEY
  employee_id: UUID (FK)
  assignment_id: UUID (FK, nullable)

  -- Session details
  started_at: TIMESTAMP
  ended_at: TIMESTAMP (nullable)
  duration_minutes: INTEGER (nullable)

  -- Actions
  actions_log: JSONB -- Detailed action tracking

  -- Results
  completed: BOOLEAN DEFAULT false
  score: INTEGER (nullable)
  errors: JSONB (nullable)

  created_at: TIMESTAMP
}
```

### Certifications
```sql
employee_certifications {
  id: UUID PRIMARY KEY
  employee_id: UUID (FK)
  certification_type: VARCHAR(100)

  -- Requirements
  required_modules: UUID[]
  completed_modules: UUID[]

  -- Status
  is_certified: BOOLEAN DEFAULT false
  certified_at: TIMESTAMP (nullable)
  expires_at: TIMESTAMP (nullable)
  certified_by: UUID (FK, nullable)

  created_at: TIMESTAMP
  updated_at: TIMESTAMP
}
```

### Training Scenarios
```sql
training_scenarios {
  id: UUID PRIMARY KEY
  location_id: UUID (FK)

  name: VARCHAR(200)
  description: TEXT

  -- Parameters
  scenario_type: VARCHAR(50) (orders, tables, bar, mixed)
  difficulty: VARCHAR(20) (beginner, intermediate, advanced)
  time_limit_minutes: INTEGER (nullable)
  parameters: JSONB -- Specific scenario settings

  -- Goals
  goals: JSONB -- What success looks like

  is_active: BOOLEAN DEFAULT true

  created_at: TIMESTAMP
  updated_at: TIMESTAMP
}
```

---

## API Endpoints

### Training Modules
```
GET    /api/training/modules
GET    /api/training/modules/{id}
POST   /api/training/modules
PUT    /api/training/modules/{id}
```

### Assignments
```
GET    /api/employees/{id}/training
POST   /api/employees/{id}/training/assign
DELETE /api/employees/{id}/training/{assignment_id}
```

### Sessions
```
POST   /api/training/sessions/start
PUT    /api/training/sessions/{id}/action
POST   /api/training/sessions/{id}/complete
GET    /api/training/sessions/{id}/results
```

### Progress
```
GET    /api/employees/{id}/training/progress
GET    /api/training/progress/overview
GET    /api/training/progress/by-module
```

### Certifications
```
GET    /api/employees/{id}/certifications
POST   /api/employees/{id}/certifications/{type}/grant
GET    /api/certifications/requirements
```

### Training Mode
```
POST   /api/training/mode/start
POST   /api/training/mode/end
GET    /api/training/mode/status
```

---

## Business Rules

1. **Data Isolation:** Training mode uses separate data, never real
2. **Certification Required:** May require certification before live work
3. **Progress Persistence:** Training progress saved across sessions
4. **No Skipping:** Prerequisites must be completed in order
5. **Expiration:** Certifications may expire and require recertification
6. **Manager Approval:** Final certification may require manager sign-off

---

## Permissions

| Action | Employee | Manager | Admin |
|--------|----------|---------|-------|
| Access training | Assigned | Yes | Yes |
| View own progress | Yes | Yes | Yes |
| View all progress | No | Yes | Yes |
| Assign training | No | Yes | Yes |
| Create modules | No | No | Yes |
| Grant certification | No | Yes | Yes |
| Configure training | No | Yes | Yes |

---

## Configuration Options

```yaml
training:
  mode:
    visual_indicator: true
    watermark: true
    distinct_colors: true
    exit_requires_pin: true

  progress:
    save_frequency_minutes: 5
    track_actions: true
    show_hints: true

  certification:
    enabled: true
    expiration_months: 12
    require_manager_approval: true

  scenarios:
    allow_custom: true
    time_limits: true
```

---

## Open Questions

1. **Video Tutorials:** Include video content?

2. **Gamification:** Leaderboards, badges, achievements?

3. **Mobile Training:** Train on personal devices?

4. **Multi-Language:** Training content in multiple languages?

5. **Integration:** Third-party training platforms?

---

## Status & Progress

### Planning
- [x] Initial requirements documented
- [ ] Tutorial content outlined
- [ ] Assessment criteria defined

### Development
- [ ] Training mode toggle
- [ ] Tutorial engine
- [ ] Progress tracking
- [ ] Assessment system
- [ ] Certification workflow
- [ ] Manager dashboard

---

*Last Updated: January 27, 2026*
