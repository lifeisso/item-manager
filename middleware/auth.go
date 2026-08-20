package middleware

import (
	"context"
	"net/http"
	"os"
	"strings"
	"time"

	"item-manager/db"

	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
)

// Claims represents JWT claims
type Claims struct {
	UserID   string `json:"user_id"`
	Username string `json:"username"`
	IsGroup  bool   `json:"is_group"`
	jwt.RegisteredClaims
}

// GenerateToken generates a JWT token for a user
func GenerateToken(userID uuid.UUID, username string, isGroup bool) (string, error) {
	secret := getJWTSecret()
	expirationTime := time.Now().Add(24 * time.Hour) // 24 hours

	claims := &Claims{
		UserID:   userID.String(),
		Username: username,
		IsGroup:  isGroup,
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(expirationTime),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
		},
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString(secret)
}

// AuthMiddleware validates JWT token and sets user info in context
func AuthMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		authHeader := c.GetHeader("Authorization")
		if authHeader == "" {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "缺少认证令牌"})
			c.Abort()
			return
		}

		parts := strings.SplitN(authHeader, " ", 2)
		if len(parts) != 2 || parts[0] != "Bearer" {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "认证令牌格式错误"})
			c.Abort()
			return
		}

		tokenStr := parts[1]
		claims := &Claims{}

		token, err := jwt.ParseWithClaims(tokenStr, claims, func(token *jwt.Token) (interface{}, error) {
			return getJWTSecret(), nil
		})

		if err != nil || !token.Valid {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "无效或过期的认证令牌"})
			c.Abort()
			return
		}

		// Check if session exists in database
		var exists bool
		err = db.Pool.QueryRow(context.Background(),
			"SELECT EXISTS(SELECT 1 FROM sessions WHERE token = $1 AND expires_at > NOW())",
			tokenStr,
		).Scan(&exists)
		if err != nil || !exists {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "会话已失效，请重新登录"})
			c.Abort()
			return
		}

		userID, err := uuid.Parse(claims.UserID)
		if err != nil {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "无效的用户ID"})
			c.Abort()
			return
		}

		c.Set("user_id", userID)
		c.Set("username", claims.Username)
		c.Set("is_group", claims.IsGroup)
		c.Next()
	}
}

// GetUserID extracts user ID from context
func GetUserID(c *gin.Context) uuid.UUID {
	return c.MustGet("user_id").(uuid.UUID)
}

// GetUsername extracts username from context
func GetUsername(c *gin.Context) string {
	return c.MustGet("username").(string)
}

// IsGroup checks if current user is a group account
func IsGroup(c *gin.Context) bool {
	return c.MustGet("is_group").(bool)
}

func getJWTSecret() []byte {
	secret := os.Getenv("JWT_SECRET")
	if secret == "" {
		secret = "item-manager-default-secret-change-in-production"
	}
	return []byte(secret)
}
