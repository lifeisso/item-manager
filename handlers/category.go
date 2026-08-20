package handlers

import (
	"context"
	"net/http"

	"item-manager/db"
	"item-manager/middleware"
	"item-manager/models"

	"github.com/gin-gonic/gin"
)

// GetCategories returns all categories for the current user
func GetCategories(c *gin.Context) {
	userID := middleware.GetUserID(c)

	rows, err := db.Pool.Query(context.Background(),
		`SELECT id, name, user_id, is_default, created_at 
		 FROM categories WHERE user_id = $1 
		 ORDER BY is_default DESC, name ASC`, userID,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "查询分类失败"})
		return
	}
	defer rows.Close()

	categories := []models.Category{}
	for rows.Next() {
		var cat models.Category
		if err := rows.Scan(&cat.ID, &cat.Name, &cat.UserID, &cat.IsDefault, &cat.CreatedAt); err == nil {
			categories = append(categories, cat)
		}
	}

	c.JSON(http.StatusOK, gin.H{"categories": categories})
}

// CreateCategory creates a new custom category
func CreateCategory(c *gin.Context) {
	userID := middleware.GetUserID(c)

	var req models.CreateCategoryRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "请求参数无效"})
		return
	}

	var cat models.Category
	err := db.Pool.QueryRow(context.Background(),
		`INSERT INTO categories (name, user_id, is_default) VALUES ($1, $2, false) 
		 RETURNING id, name, user_id, is_default, created_at`,
		req.Name, userID,
	).Scan(&cat.ID, &cat.Name, &cat.UserID, &cat.IsDefault, &cat.CreatedAt)

	if err != nil {
		c.JSON(http.StatusConflict, gin.H{"error": "分类名称已存在"})
		return
	}

	c.JSON(http.StatusCreated, gin.H{
		"message":  "分类创建成功",
		"category": cat,
	})
}

// UpdateCategory updates a category name
func UpdateCategory(c *gin.Context) {
	userID := middleware.GetUserID(c)
	catID := c.Param("id")

	var req models.UpdateCategoryRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "请求参数无效"})
		return
	}

	// Check if category belongs to user
	var isDefault bool
	err := db.Pool.QueryRow(context.Background(),
		`SELECT is_default FROM categories WHERE id = $1 AND user_id = $2`,
		catID, userID,
	).Scan(&isDefault)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "分类不存在"})
		return
	}

	if isDefault {
		c.JSON(http.StatusForbidden, gin.H{"error": "不能修改默认分类"})
		return
	}

	var cat models.Category
	err = db.Pool.QueryRow(context.Background(),
		`UPDATE categories SET name = $1 WHERE id = $2 AND user_id = $3 
		 RETURNING id, name, user_id, is_default, created_at`,
		req.Name, catID, userID,
	).Scan(&cat.ID, &cat.Name, &cat.UserID, &cat.IsDefault, &cat.CreatedAt)

	if err != nil {
		c.JSON(http.StatusConflict, gin.H{"error": "分类名称已存在"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"message":  "分类更新成功",
		"category": cat,
	})
}

// DeleteCategory deletes a custom category
func DeleteCategory(c *gin.Context) {
	userID := middleware.GetUserID(c)
	catID := c.Param("id")

	// Check if category belongs to user and is not default
	var isDefault bool
	err := db.Pool.QueryRow(context.Background(),
		`SELECT is_default FROM categories WHERE id = $1 AND user_id = $2`,
		catID, userID,
	).Scan(&isDefault)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "分类不存在"})
		return
	}

	if isDefault {
		c.JSON(http.StatusForbidden, gin.H{"error": "不能删除默认分类"})
		return
	}

	// Check if there are items using this category
	var itemCount int
	err = db.Pool.QueryRow(context.Background(),
		`SELECT COUNT(*) FROM items WHERE category_id = $1 AND owner_id = $2`,
		catID, userID,
	).Scan(&itemCount)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "查询物品失败"})
		return
	}

	if itemCount > 0 {
		c.JSON(http.StatusConflict, gin.H{"error": "该分类下还有物品，请先删除或移动相关物品"})
		return
	}

	_, err = db.Pool.Exec(context.Background(),
		`DELETE FROM categories WHERE id = $1 AND user_id = $2`,
		catID, userID,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "删除分类失败"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "分类删除成功"})
}
