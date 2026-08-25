package models

import (
	"time"

	"github.com/google/uuid"
)

// MaintenancePlan represents a device/equipment that needs periodic maintenance
type MaintenancePlan struct {
	ID          uuid.UUID `json:"id"`
	Name        string    `json:"name"`
	Icon        string    `json:"icon"`
	Description string    `json:"description"`
	UserID      uuid.UUID `json:"user_id"`
	DueCount    int       `json:"due_count"`     // computed: number of items due within 7 days
	TotalCount  int       `json:"total_count"`   // computed: total items under this plan
	NextDueDate *string   `json:"next_due_date"` // computed: earliest next_due_date
	CreatedAt   time.Time `json:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"`
}

// MaintenanceItem represents a single maintenance task/part with a cycle
type MaintenanceItem struct {
	ID           uuid.UUID `json:"id"`
	PlanID       uuid.UUID `json:"plan_id"`
	PlanName     string    `json:"plan_name"`
	PlanIcon     string    `json:"plan_icon"`
	Name         string    `json:"name"`
	CycleDays    int       `json:"cycle_days"`
	LastDoneDate *string   `json:"last_done_date"` // YYYY-MM-DD, null = never done
	NextDueDate  string    `json:"next_due_date"`  // YYYY-MM-DD, computed
	SortOrder    int       `json:"sort_order"`
	IsOverdue    bool      `json:"is_overdue"`     // computed: next_due_date <= today
	DaysUntilDue int       `json:"days_until_due"` // computed: days until next_due_date
	CreatedAt    time.Time `json:"created_at"`
	UpdatedAt    time.Time `json:"updated_at"`
}

// CreatePlanRequest represents creating a maintenance plan
type CreatePlanRequest struct {
	Name        string `json:"name" binding:"required,min=1,max=100"`
	Icon        string `json:"icon" binding:"max=10"`
	Description string `json:"description"`
	Template    string `json:"template"` // optional: "water_purifier", "car"
}

// UpdatePlanRequest represents updating a maintenance plan
type UpdatePlanRequest struct {
	Name        string `json:"name" binding:"required,min=1,max=100"`
	Icon        string `json:"icon" binding:"max=10"`
	Description string `json:"description"`
}

// CreateMaintItemRequest represents creating a maintenance item
type CreateMaintItemRequest struct {
	Name         string `json:"name" binding:"required,min=1,max=100"`
	CycleDays    int    `json:"cycle_days" binding:"required,min=1,max=3650"`
	LastDoneDate string `json:"last_done_date"` // optional, YYYY-MM-DD
	SortOrder    int    `json:"sort_order"`
}

// UpdateMaintItemRequest represents updating a maintenance item
type UpdateMaintItemRequest struct {
	Name         string `json:"name" binding:"required,min=1,max=100"`
	CycleDays    int    `json:"cycle_days" binding:"required,min=1,max=3650"`
	LastDoneDate string `json:"last_done_date"` // optional, YYYY-MM-DD
	SortOrder    int    `json:"sort_order"`
}

// MaintenanceRecord represents a single maintenance completion record
type MaintenanceRecord struct {
	ID        uuid.UUID `json:"id"`
	ItemID    uuid.UUID `json:"item_id"`
	PlanID    uuid.UUID `json:"plan_id"`
	ItemName  string    `json:"item_name"`
	PlanName  string    `json:"plan_name"`
	PlanIcon  string    `json:"plan_icon"`
	DoneDate  string    `json:"done_date"` // YYYY-MM-DD
	Note      string    `json:"note"`
	CreatedAt time.Time `json:"created_at"`
}
