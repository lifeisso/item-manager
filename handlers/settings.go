package handlers

import (
	"context"
	"net/http"

	"item-manager/db"
	"item-manager/middleware"

	"github.com/gin-gonic/gin"
)

// GetExpiringDays returns the user's expiring_days setting
func GetExpiringDays(c *gin.Context) {
	userID := middleware.GetUserID(c)

	var expiringDays int
	err := db.Pool.QueryRow(context.Background(),
		`SELECT COALESCE(expiring_days, 30) FROM users WHERE id = $1`, userID,
	).Scan(&expiringDays)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "查询设置失败"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"expiring_days": expiringDays,
	})
}

// UpdateExpiringDays updates the user's expiring_days setting
func UpdateExpiringDays(c *gin.Context) {
	userID := middleware.GetUserID(c)

	var req struct {
		ExpiringDays int `json:"expiring_days" binding:"required,min=1,max=365"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "天数范围应为1-365"})
		return
	}

	_, err := db.Pool.Exec(context.Background(),
		`UPDATE users SET expiring_days = $1, updated_at = NOW() WHERE id = $2`,
		req.ExpiringDays, userID,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "更新设置失败"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"message":       "设置更新成功",
		"expiring_days": req.ExpiringDays,
	})
}
