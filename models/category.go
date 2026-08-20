package models

import (
	"time"

	"github.com/google/uuid"
)

// Category represents an item category
type Category struct {
	ID        int       `json:"id"`
	Name      string    `json:"name"`
	UserID    uuid.UUID `json:"user_id"`
	IsDefault bool      `json:"is_default"`
	CreatedAt time.Time `json:"created_at"`
}

// CreateCategoryRequest represents creating a custom category
type CreateCategoryRequest struct {
	Name string `json:"name" binding:"required,min=1,max=100"`
}

// UpdateCategoryRequest represents updating a category
type UpdateCategoryRequest struct {
	Name string `json:"name" binding:"required,min=1,max=100"`
}

// Default category names
var DefaultCategories = []string{"药品", "食物", "家居"}
