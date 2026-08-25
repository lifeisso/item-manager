package models

import (
	"time"

	"github.com/google/uuid"
)

// Suggestion represents a user feedback/suggestion with optional file attachment
type Suggestion struct {
	ID        uuid.UUID `json:"id"`
	UserID    uuid.UUID `json:"user_id"`
	Content   string    `json:"content"`
	FileName  string    `json:"file_name"`
	FileURL   string    `json:"file_url"`
	FileSize  int64     `json:"file_size"`
	CreatedAt time.Time `json:"created_at"`
	Username  string    `json:"username,omitempty"`
}
