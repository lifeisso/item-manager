package handlers

import (
	"context"
	"net/http"
	"os"
	"strings"

	"item-manager/db"
	"item-manager/middleware"
	"item-manager/models"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

const maxFileSize = 50 << 20 // 50MB

// CreateSuggestion - 提交意见（可选附带文件）
func CreateSuggestion(c *gin.Context) {
	userID := middleware.GetUserID(c)
	// Set max multipart form size to 50MB
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, maxFileSize+1024) // extra 1KB for form fields
	content := c.PostForm("content")
	if strings.TrimSpace(content) == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "请输入意见内容"})
		return
	}

	var fileName string
	var fileURL string
	var fileSize int64

	// Handle optional file upload
	file, err := c.FormFile("file")
	if err == nil && file != nil {
		if file.Size > maxFileSize {
			c.JSON(http.StatusBadRequest, gin.H{"error": "文件大小不能超过50MB"})
			return
		}
		ext := file.Filename[strings.LastIndex(file.Filename, "."):]
		filename := uuid.New().String() + ext
		filepath := "./uploads/suggestions/" + filename

		// Create directory if not exists
		os.MkdirAll("./uploads/suggestions", 0755)

		if err := c.SaveUploadedFile(file, filepath); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "保存文件失败"})
			return
		}
		fileName = file.Filename
		fileURL = "/uploads/suggestions/" + filename
		fileSize = file.Size
	}

	var id uuid.UUID
	err = db.Pool.QueryRow(context.Background(), `
		INSERT INTO suggestions (user_id, content, file_name, file_url, file_size)
		VALUES ($1, $2, $3, $4, $5)
		RETURNING id
	`, userID, content, fileName, fileURL, fileSize).Scan(&id)

	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "提交意见失败"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"message": "提交成功",
		"id":      id,
	})
}

// GetSuggestions - 获取当前用户的意见列表
func GetSuggestions(c *gin.Context) {
	userID := middleware.GetUserID(c)

	rows, err := db.Pool.Query(context.Background(), `
		SELECT s.id, s.user_id, s.content, s.file_name, s.file_url, s.file_size, s.created_at, u.username
		FROM suggestions s
		JOIN users u ON s.user_id = u.id
		WHERE s.user_id = $1
		ORDER BY s.created_at DESC
	`, userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "查询意见失败"})
		return
	}
	defer rows.Close()

	suggestions := []models.Suggestion{}
	for rows.Next() {
		var s models.Suggestion
		if err := rows.Scan(&s.ID, &s.UserID, &s.Content, &s.FileName, &s.FileURL, &s.FileSize, &s.CreatedAt, &s.Username); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "解析意见失败"})
			return
		}
		suggestions = append(suggestions, s)
	}

	c.JSON(http.StatusOK, gin.H{"suggestions": suggestions})
}

// GetAllSuggestions - 管理员获取所有意见（组账号可查看）
func GetAllSuggestions(c *gin.Context) {
	userID := middleware.GetUserID(c)

	// Check if user is group account
	var isGroup bool
	err := db.Pool.QueryRow(context.Background(), `SELECT is_group FROM users WHERE id = $1`, userID).Scan(&isGroup)
	if err != nil || !isGroup {
		c.JSON(http.StatusForbidden, gin.H{"error": "无权限查看"})
		return
	}

	rows, err := db.Pool.Query(context.Background(), `
		SELECT s.id, s.user_id, s.content, s.file_name, s.file_url, s.file_size, s.created_at, u.username
		FROM suggestions s
		JOIN users u ON s.user_id = u.id
		ORDER BY s.created_at DESC
	`)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "查询意见失败"})
		return
	}
	defer rows.Close()

	suggestions := []models.Suggestion{}
	for rows.Next() {
		var s models.Suggestion
		if err := rows.Scan(&s.ID, &s.UserID, &s.Content, &s.FileName, &s.FileURL, &s.FileSize, &s.CreatedAt, &s.Username); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "解析意见失败"})
			return
		}
		suggestions = append(suggestions, s)
	}

	c.JSON(http.StatusOK, gin.H{"suggestions": suggestions})
}

// DeleteSuggestion - 删除意见
func DeleteSuggestion(c *gin.Context) {
	userID := middleware.GetUserID(c)
	suggestionID := c.Param("id")

	// Get file info before deleting
	var fileURL string
	err := db.Pool.QueryRow(context.Background(), `
		SELECT file_url FROM suggestions WHERE id = $1 AND user_id = $2
	`, suggestionID, userID).Scan(&fileURL)

	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "意见不存在"})
		return
	}

	// Delete file from disk
	if fileURL != "" {
		filePath := "." + fileURL
		os.Remove(filePath)
	}

	result, err := db.Pool.Exec(context.Background(), `
		DELETE FROM suggestions WHERE id = $1 AND user_id = $2
	`, suggestionID, userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "删除意见失败"})
		return
	}
	if result.RowsAffected() == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "意见不存在"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "删除成功"})
}

// DownloadSuggestionFile - 下载意见附件
func DownloadSuggestionFile(c *gin.Context) {
	suggestionID := c.Param("id")

	var fileURL string
	err := db.Pool.QueryRow(context.Background(), `
		SELECT file_url FROM suggestions WHERE id = $1
	`, suggestionID).Scan(&fileURL)

	if err != nil || fileURL == "" {
		c.JSON(http.StatusNotFound, gin.H{"error": "文件不存在"})
		return
	}

	// Serve the file
	filePath := "." + fileURL
	if _, err := os.Stat(filePath); os.IsNotExist(err) {
		c.JSON(http.StatusNotFound, gin.H{"error": "文件不存在"})
		return
	}

	c.File(filePath)
}

// Helper to format time - currently unused, kept for future use
// func formatTime(t time.Time) string {
// 	return t.Format("2006-01-02 15:04")
// }
