package handlers

import (
	"context"
	"net/http"

	"item-manager/db"
	"item-manager/middleware"
	"item-manager/models"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

// JoinGroup handles a user joining a group
func JoinGroup(c *gin.Context) {
	userID := middleware.GetUserID(c)

	var req models.GroupJoinRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "请求参数无效"})
		return
	}

	// Check if user already belongs to a group
	var existingGroupID *uuid.UUID
	err := db.Pool.QueryRow(context.Background(),
		`SELECT group_id FROM users WHERE id = $1`, userID,
	).Scan(&existingGroupID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "查询用户信息失败"})
		return
	}

	if existingGroupID != nil {
		c.JSON(http.StatusConflict, gin.H{"error": "您已加入一个组，请先退出当前组"})
		return
	}

	// Find the group by username
	var groupID uuid.UUID
	var isGroup bool
	err = db.Pool.QueryRow(context.Background(),
		`SELECT id, is_group FROM users WHERE username = $1`, req.GroupUsername,
	).Scan(&groupID, &isGroup)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "组账号不存在"})
		return
	}

	if !isGroup {
		c.JSON(http.StatusBadRequest, gin.H{"error": "指定的账号不是组账号"})
		return
	}

	// Join the group
	_, err = db.Pool.Exec(context.Background(),
		`UPDATE users SET group_id = $1, updated_at = NOW() WHERE id = $2`,
		groupID, userID,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "加入组失败"})
		return
	}

	// Update items: set ownergroup_id for shared items (is_private=false) that have no group
	_, err = db.Pool.Exec(context.Background(),
		`UPDATE items SET ownergroup_id = $1 WHERE owner_id = $2 AND is_private = false AND ownergroup_id IS NULL`,
		groupID, userID,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "更新物品归属组失败"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"message":    "加入组成功",
		"group_id":   groupID,
		"group_name": req.GroupUsername,
	})
}

// LeaveGroup handles a user leaving a group
func LeaveGroup(c *gin.Context) {
	userID := middleware.GetUserID(c)

	// Check if user belongs to a group
	var groupID *uuid.UUID
	err := db.Pool.QueryRow(context.Background(),
		`SELECT group_id FROM users WHERE id = $1`, userID,
	).Scan(&groupID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "查询用户信息失败"})
		return
	}

	if groupID == nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "您未加入任何组"})
		return
	}

	// Leave the group
	_, err = db.Pool.Exec(context.Background(),
		`UPDATE users SET group_id = NULL, updated_at = NOW() WHERE id = $1`,
		userID,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "退出组失败"})
		return
	}

	// Update items: clear ownergroup_id for items that belonged to this group
	_, err = db.Pool.Exec(context.Background(),
		`UPDATE items SET ownergroup_id = NULL WHERE owner_id = $1 AND ownergroup_id = $2`,
		userID, *groupID,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "更新物品归属组失败"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "退出组成功"})
}

// GetGroupInfo returns group information
func GetGroupInfo(c *gin.Context) {
	userID := middleware.GetUserID(c)
	isGroup := middleware.IsGroup(c)

	if isGroup {
		// Current user IS the group account
		rows, err := db.Pool.Query(context.Background(),
			`SELECT id, username, created_at FROM users WHERE group_id = $1`, userID,
		)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "查询组成员失败"})
			return
		}
		defer rows.Close()

		type Member struct {
			ID        uuid.UUID `json:"id"`
			Username  string    `json:"username"`
			CreatedAt string    `json:"created_at"`
		}

		members := []Member{}
		for rows.Next() {
			var m Member
			if err := rows.Scan(&m.ID, &m.Username, &m.CreatedAt); err == nil {
				members = append(members, m)
			}
		}

		c.JSON(http.StatusOK, gin.H{
			"is_group": true,
			"members":  members,
		})
		return
	}

	// Current user is an individual account
	var groupID *uuid.UUID
	err := db.Pool.QueryRow(context.Background(),
		`SELECT group_id FROM users WHERE id = $1`, userID,
	).Scan(&groupID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "查询用户信息失败"})
		return
	}

	if groupID == nil {
		c.JSON(http.StatusOK, gin.H{
			"is_group": false,
			"group":    nil,
		})
		return
	}

	var groupName string
	err = db.Pool.QueryRow(context.Background(),
		`SELECT username FROM users WHERE id = $1`, groupID,
	).Scan(&groupName)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "查询组信息失败"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"is_group": false,
		"group": gin.H{
			"id":   groupID,
			"name": groupName,
		},
	})
}
