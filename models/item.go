package models

import (
	"time"

	"github.com/google/uuid"
)

// Item represents a stored item
type Item struct {
	ID             uuid.UUID  `json:"id"`
	Name           string     `json:"name"`
	CategoryID     int        `json:"category_id"`
	CategoryName   string     `json:"category_name"`
	Manufacturer   string     `json:"manufacturer"`
	UsageDesc      string     `json:"usage_desc"`
	ProductionDate string     `json:"production_date"` // YYYY-MM-DD
	ExpiryDate     string     `json:"expiry_date"`     // YYYY-MM-DD
	ImageURL       string     `json:"image_url"`
	OwnerID        uuid.UUID  `json:"owner_id"`
	OwnergroupID   *uuid.UUID `json:"ownergroup_id"`   // NULL for private items, group_id for shared items
	OwnergroupName string     `json:"ownergroup_name"` // group name for display
	IsPrivate      bool       `json:"is_private"`
	CreatedBy      uuid.UUID  `json:"created_by"`
	CreatedByName  string     `json:"created_by_name"`
	CreatedAt      time.Time  `json:"created_at"`
	UpdatedAt      time.Time  `json:"updated_at"`
}

// CreateItemRequest represents creating a new item
type CreateItemRequest struct {
	Name           string `json:"name" binding:"required,min=1,max=255"`
	CategoryID     int    `json:"category_id" binding:"required"`
	Manufacturer   string `json:"manufacturer"`
	UsageDesc      string `json:"usage_desc"`
	ProductionDate string `json:"production_date" binding:"required"` // YYYY-MM-DD
	ExpiryDate     string `json:"expiry_date" binding:"required"`     // YYYY-MM-DD
	ImageURL       string `json:"image_url"`
	IsPrivate      bool   `json:"is_private"` // Default false = group shared
}

// UpdateItemRequest represents updating an item
type UpdateItemRequest struct {
	Name           string `json:"name" binding:"required,min=1,max=255"`
	CategoryID     int    `json:"category_id" binding:"required"`
	Manufacturer   string `json:"manufacturer"`
	UsageDesc      string `json:"usage_desc"`
	ProductionDate string `json:"production_date" binding:"required"`
	ExpiryDate     string `json:"expiry_date" binding:"required"`
	ImageURL       string `json:"image_url"`
	IsPrivate      *bool  `json:"is_private"` // Pointer to distinguish between false and not provided
}

// ItemListQuery represents query parameters for listing items
type ItemListQuery struct {
	CategoryID int    `form:"category_id"`
	Owner      string `form:"owner"` // "self" or "group"
	Page       int    `form:"page,default=1"`
	PageSize   int    `form:"page_size,default=20"`
	Keyword    string `form:"keyword"`
}
