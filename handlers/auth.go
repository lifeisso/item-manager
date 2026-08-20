package handlers

import (
	"context"
	"net/http"
	"time"

	"item-manager/db"
	"item-manager/middleware"
	"item-manager/models"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"golang.org/x/crypto/bcrypt"
)

// Register handles user registration
func Register(c *gin.Context) {
	var req models.RegisterRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "请求参数无效: " + err.Error()})
		return
	}

	// Hash password
	hashedPassword, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "密码加密失败"})
		return
	}

	var userID uuid.UUID
	err = db.Pool.QueryRow(context.Background(),
		`INSERT INTO users (username, password_hash, is_group) VALUES ($1, $2, $3) RETURNING id`,
		req.Username, string(hashedPassword), req.IsGroup,
	).Scan(&userID)

	if err != nil {
		c.JSON(http.StatusConflict, gin.H{"error": "用户名已存在"})
		return
	}

	// Create default categories for the new user/group
	for _, catName := range models.DefaultCategories {
		_, err := db.Pool.Exec(context.Background(),
			`INSERT INTO categories (name, user_id, is_default) VALUES ($1, $2, true)`,
			catName, userID,
		)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "创建默认分类失败"})
			return
		}
	}

	// Generate token
	token, err := middleware.GenerateToken(userID, req.Username, req.IsGroup)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "生成令牌失败"})
		return
	}

	// Save session
	_, err = db.Pool.Exec(context.Background(),
		`INSERT INTO sessions (user_id, token, expires_at) VALUES ($1, $2, $3)`,
		userID, token, time.Now().Add(24*time.Hour),
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "创建会话失败"})
		return
	}

	c.JSON(http.StatusCreated, gin.H{
		"message": "注册成功",
		"token":   token,
		"user": gin.H{
			"id":       userID,
			"username": req.Username,
			"is_group": req.IsGroup,
		},
	})
}

// Login handles user login
func Login(c *gin.Context) {
	var req models.LoginRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "请求参数无效"})
		return
	}

	var user models.User
	err := db.Pool.QueryRow(context.Background(),
		`SELECT id, username, password_hash, is_group, group_id, created_at, updated_at 
		 FROM users WHERE username = $1`,
		req.Username,
	).Scan(&user.ID, &user.Username, &user.PasswordHash, &user.IsGroup, &user.GroupID, &user.CreatedAt, &user.UpdatedAt)

	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "用户名或密码错误"})
		return
	}

	// Verify password
	if err := bcrypt.CompareHashAndPassword([]byte(user.PasswordHash), []byte(req.Password)); err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "用户名或密码错误"})
		return
	}

	// Generate token
	token, err := middleware.GenerateToken(user.ID, user.Username, user.IsGroup)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "生成令牌失败"})
		return
	}

	// Save session
	_, err = db.Pool.Exec(context.Background(),
		`INSERT INTO sessions (user_id, token, expires_at) VALUES ($1, $2, $3)`,
		user.ID, token, time.Now().Add(24*time.Hour),
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "创建会话失败"})
		return
	}

	// Get group info if applicable
	response := models.LoginResponse{
		Token: token,
		User:  user,
	}

	if user.GroupID != nil {
		var groupName string
		err := db.Pool.QueryRow(context.Background(),
			`SELECT username FROM users WHERE id = $1`, user.GroupID,
		).Scan(&groupName)
		if err == nil {
			response.GroupID = user.GroupID.String()
			response.GroupName = groupName
		}
	}

	c.JSON(http.StatusOK, gin.H{
		"message": "登录成功",
		"token":   response.Token,
		"user": gin.H{
			"id":         user.ID,
			"username":   user.Username,
			"is_group":   user.IsGroup,
			"group_id":   response.GroupID,
			"group_name": response.GroupName,
		},
	})
}

// Logout handles user logout
func Logout(c *gin.Context) {
	authHeader := c.GetHeader("Authorization")
	if authHeader == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "缺少认证令牌"})
		return
	}

	parts := []string{authHeader}
	if len(parts) > 0 {
		tokenStr := authHeader
		if len(authHeader) > 7 && authHeader[:7] == "Bearer " {
			tokenStr = authHeader[7:]
		}
		// Delete session
		_, err := db.Pool.Exec(context.Background(),
			`DELETE FROM sessions WHERE token = $1`, tokenStr,
		)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "退出登录失败"})
			return
		}
	}

	c.JSON(http.StatusOK, gin.H{"message": "退出登录成功"})
}

// GetUserInfo returns current user info
func GetUserInfo(c *gin.Context) {
	userID := middleware.GetUserID(c)

	var user models.User
	err := db.Pool.QueryRow(context.Background(),
		`SELECT id, username, is_group, group_id, created_at, updated_at 
		 FROM users WHERE id = $1`, userID,
	).Scan(&user.ID, &user.Username, &user.IsGroup, &user.GroupID, &user.CreatedAt, &user.UpdatedAt)

	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "用户不存在"})
		return
	}

	resp := models.UserInfoResponse{
		ID:        user.ID,
		Username:  user.Username,
		IsGroup:   user.IsGroup,
		GroupID:   user.GroupID,
		CreatedAt: user.CreatedAt,
	}

	// Get group name
	if user.GroupID != nil {
		var groupName string
		db.Pool.QueryRow(context.Background(),
			`SELECT username FROM users WHERE id = $1`, user.GroupID,
		).Scan(&groupName)
		resp.GroupName = groupName
	}

	// Get members if this is a group account
	if user.IsGroup {
		rows, err := db.Pool.Query(context.Background(),
			`SELECT username FROM users WHERE group_id = $1`, user.ID,
		)
		if err == nil {
			defer rows.Close()
			for rows.Next() {
				var memberName string
				if err := rows.Scan(&memberName); err == nil {
					resp.Members = append(resp.Members, memberName)
				}
			}
		}
	}

	c.JSON(http.StatusOK, resp)
}

// DeleteAccount handles account deletion
func DeleteAccount(c *gin.Context) {
	userID := middleware.GetUserID(c)

	var req models.DeleteAccountRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "请求参数无效"})
		return
	}

	// Verify password
	var passwordHash string
	err := db.Pool.QueryRow(context.Background(),
		`SELECT password_hash FROM users WHERE id = $1`, userID,
	).Scan(&passwordHash)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "用户不存在"})
		return
	}

	if err := bcrypt.CompareHashAndPassword([]byte(passwordHash), []byte(req.Password)); err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "密码错误"})
		return
	}

	// Delete user (cascade will handle related records)
	_, err = db.Pool.Exec(context.Background(),
		`DELETE FROM users WHERE id = $1`, userID,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "注销账号失败"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "账号已注销"})
}
