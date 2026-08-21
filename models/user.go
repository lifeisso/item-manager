package models

import (
	"time"

	"github.com/google/uuid"
)

// User represents both individual and group accounts
type User struct {
	ID           uuid.UUID  `json:"id"`
	Username     string     `json:"username"`
	PasswordHash string     `json:"-"` // Never expose password hash
	IsGroup      bool       `json:"is_group"`
	GroupID      *uuid.UUID `json:"group_id,omitempty"`
	ExpiringDays int        `json:"expiring_days"` // 每个用户独立的过期查询范围天数
	CreatedAt    time.Time  `json:"created_at"`
	UpdatedAt    time.Time  `json:"updated_at"`
}

// RegisterRequest represents the registration request body
type RegisterRequest struct {
	Username string `json:"username" binding:"required,min=3,max=50"`
	Password string `json:"password" binding:"required,min=6,max=100"`
	IsGroup  bool   `json:"is_group"`
}

// LoginRequest represents the login request body
type LoginRequest struct {
	Username string `json:"username" binding:"required"`
	Password string `json:"password" binding:"required"`
}

// LoginResponse represents the login response
type LoginResponse struct {
	Token     string `json:"token"`
	User      User   `json:"user"`
	GroupID   string `json:"group_id,omitempty"`
	GroupName string `json:"group_name,omitempty"`
}

// GroupJoinRequest represents joining a group
type GroupJoinRequest struct {
	GroupUsername string `json:"group_username" binding:"required"`
}

// UserInfoResponse represents user info with group details
type UserInfoResponse struct {
	ID        uuid.UUID  `json:"id"`
	Username  string     `json:"username"`
	IsGroup   bool       `json:"is_group"`
	GroupID   *uuid.UUID `json:"group_id,omitempty"`
	GroupName string     `json:"group_name,omitempty"`
	Members   []string   `json:"members,omitempty"` // For group accounts
	CreatedAt time.Time  `json:"created_at"`
}

// DeleteAccountRequest represents account deletion
type DeleteAccountRequest struct {
	Password string `json:"password" binding:"required"`
}
