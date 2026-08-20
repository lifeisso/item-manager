package handlers

import (
	"context"
	"fmt"
	"net/http"
	"strings"
	"time"

	"item-manager/db"
	"item-manager/middleware"
	"item-manager/models"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

// getOwnerID determines the owner_id based on isPrivate flag
// If isPrivate=true, owner_id = current user
// If isPrivate=false (default, group shared), owner_id = group_id if user has a group, otherwise user_id
func getOwnerID(ctx context.Context, userID uuid.UUID, isPrivate bool) (uuid.UUID, error) {
	if isPrivate {
		return userID, nil
	}

	// Check if user has a group
	var groupID *uuid.UUID
	err := db.Pool.QueryRow(ctx,
		`SELECT group_id FROM users WHERE id = $1`, userID,
	).Scan(&groupID)
	if err != nil {
		return uuid.Nil, fmt.Errorf("查询用户组信息失败")
	}

	if groupID != nil {
		return *groupID, nil
	}

	// User has no group, items belong to user
	return userID, nil
}

// CreateItem creates a new item
func CreateItem(c *gin.Context) {
	userID := middleware.GetUserID(c)

	var req models.CreateItemRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "请求参数无效: " + err.Error()})
		return
	}

	// Validate dates
	prodDate, err := time.Parse("2006-01-02", req.ProductionDate)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "生产日期格式无效，请使用YYYY-MM-DD格式"})
		return
	}
	expDate, err := time.Parse("2006-01-02", req.ExpiryDate)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "过期日期格式无效，请使用YYYY-MM-DD格式"})
		return
	}
	if expDate.Before(prodDate) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "过期日期不能早于生产日期"})
		return
	}

	// Verify category belongs to user
	var catExists bool
	err = db.Pool.QueryRow(context.Background(),
		`SELECT EXISTS(SELECT 1 FROM categories WHERE id = $1 AND user_id = $2)`,
		req.CategoryID, userID,
	).Scan(&catExists)
	if err != nil || !catExists {
		c.JSON(http.StatusBadRequest, gin.H{"error": "分类不存在或不属于当前用户"})
		return
	}

	// Determine owner_id
	ownerID, err := getOwnerID(context.Background(), userID, req.IsPrivate)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	// Check item name uniqueness within owner
	var nameExists bool
	err = db.Pool.QueryRow(context.Background(),
		`SELECT EXISTS(SELECT 1 FROM items WHERE owner_id = $1 AND name = $2)`,
		ownerID, req.Name,
	).Scan(&nameExists)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "检查物品名称失败"})
		return
	}
	if nameExists {
		ownerType := "个人"
		if !req.IsPrivate {
			ownerType = "组"
		}
		c.JSON(http.StatusConflict, gin.H{"error": fmt.Sprintf("%s物品中已存在同名物品", ownerType)})
		return
	}

	// Insert item
	var itemID uuid.UUID
	err = db.Pool.QueryRow(context.Background(),
		`INSERT INTO items (name, category_id, manufacturer, usage_desc, production_date, expiry_date, 
			image_url, owner_id, is_private, created_by) 
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
		req.Name, req.CategoryID, req.Manufacturer, req.UsageDesc,
		req.ProductionDate, req.ExpiryDate, req.ImageURL,
		ownerID, req.IsPrivate, userID,
	).Scan(&itemID)

	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "创建物品失败: " + err.Error()})
		return
	}

	c.JSON(http.StatusCreated, gin.H{
		"message": "物品创建成功",
		"item_id": itemID,
	})
}

// GetItems returns items with filtering
func GetItems(c *gin.Context) {
	userID := middleware.GetUserID(c)

	var query models.ItemListQuery
	if err := c.ShouldBindQuery(&query); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "查询参数无效"})
		return
	}

	if query.Page < 1 {
		query.Page = 1
	}
	if query.PageSize < 1 || query.PageSize > 100 {
		query.PageSize = 20
	}

	offset := (query.Page - 1) * query.PageSize

	// Build query based on owner filter
	// "self" = items owned by user (private)
	// "group" = items owned by user's group (shared)
	// default = all items accessible to user (both self and group)
	baseQuery := `
		SELECT i.id, i.name, i.category_id, c.name as category_name, 
			i.manufacturer, i.usage_desc, 
			i.production_date::text, i.expiry_date::text, 
			i.image_url, i.owner_id, i.is_private, i.created_by, 
			u.username as created_by_name,
			i.created_at, i.updated_at
		FROM items i
		LEFT JOIN categories c ON i.category_id = c.id
		LEFT JOIN users u ON i.created_by = u.id
		WHERE `

	var args []interface{}
	argIdx := 1

	switch query.Owner {
	case "self":
		// Items owned by the user (private items)
		baseQuery += fmt.Sprintf("i.owner_id = $%d", argIdx)
		args = append(args, userID)
		argIdx++
	case "group":
		// Items owned by the user's group
		var groupID *uuid.UUID
		err := db.Pool.QueryRow(context.Background(),
			`SELECT group_id FROM users WHERE id = $1`, userID,
		).Scan(&groupID)
		if err != nil || groupID == nil {
			c.JSON(http.StatusOK, gin.H{
				"items":     []interface{}{},
				"total":     0,
				"page":      query.Page,
				"page_size": query.PageSize,
			})
			return
		}
		baseQuery += fmt.Sprintf("i.owner_id = $%d", argIdx)
		args = append(args, *groupID)
		argIdx++
	default:
		// All items: both user's own and group's
		var groupID *uuid.UUID
		db.Pool.QueryRow(context.Background(),
			`SELECT group_id FROM users WHERE id = $1`, userID,
		).Scan(&groupID)

		if groupID != nil {
			baseQuery += fmt.Sprintf("(i.owner_id = $%d OR i.owner_id = $%d)", argIdx, argIdx+1)
			args = append(args, userID, *groupID)
			argIdx += 2
		} else {
			baseQuery += fmt.Sprintf("i.owner_id = $%d", argIdx)
			args = append(args, userID)
			argIdx++
		}
	}

	// Add category filter
	if query.CategoryID > 0 {
		baseQuery += fmt.Sprintf(" AND i.category_id = $%d", argIdx)
		args = append(args, query.CategoryID)
		argIdx++
	}

	// Add keyword search
	if query.Keyword != "" {
		baseQuery += fmt.Sprintf(" AND (i.name ILIKE $%d OR i.manufacturer ILIKE $%d OR i.usage_desc ILIKE $%d)",
			argIdx, argIdx+1, argIdx+2)
		keyword := "%" + query.Keyword + "%"
		args = append(args, keyword, keyword, keyword)
		argIdx += 3
	}

	// Count total
	countQuery := "SELECT COUNT(*) FROM items i LEFT JOIN categories c ON i.category_id = c.id LEFT JOIN users u ON i.created_by = u.id WHERE "
	// Rebuild WHERE for count
	countWhere := ""
	countArgs := []interface{}{}
	cargIdx := 1

	switch query.Owner {
	case "self":
		countWhere += fmt.Sprintf("i.owner_id = $%d", cargIdx)
		countArgs = append(countArgs, userID)
		cargIdx++
	case "group":
		var groupID *uuid.UUID
		db.Pool.QueryRow(context.Background(),
			`SELECT group_id FROM users WHERE id = $1`, userID,
		).Scan(&groupID)
		if groupID != nil {
			countWhere += fmt.Sprintf("i.owner_id = $%d", cargIdx)
			countArgs = append(countArgs, *groupID)
			cargIdx++
		}
	default:
		var groupID *uuid.UUID
		db.Pool.QueryRow(context.Background(),
			`SELECT group_id FROM users WHERE id = $1`, userID,
		).Scan(&groupID)
		if groupID != nil {
			countWhere += fmt.Sprintf("(i.owner_id = $%d OR i.owner_id = $%d)", cargIdx, cargIdx+1)
			countArgs = append(countArgs, userID, *groupID)
			cargIdx += 2
		} else {
			countWhere += fmt.Sprintf("i.owner_id = $%d", cargIdx)
			countArgs = append(countArgs, userID)
			cargIdx++
		}
	}
	if query.CategoryID > 0 {
		countWhere += fmt.Sprintf(" AND i.category_id = $%d", cargIdx)
		fmt.Println("-----------", countWhere);
		countArgs = append(countArgs, query.CategoryID)
		cargIdx++
	}
	if query.Keyword != "" {
		countWhere += fmt.Sprintf(" AND (i.name ILIKE $%d OR i.manufacturer ILIKE $%d OR i.usage_desc ILIKE $%d)",
			cargIdx, cargIdx+1, cargIdx+2)
		keyword := "%" + query.Keyword + "%"
		countArgs = append(countArgs, keyword, keyword, keyword)
	}

	fmt.Println("-----------====", countQuery+countWhere);
	var total int
	db.Pool.QueryRow(context.Background(), countQuery+countWhere, countArgs...).Scan(&total)

	// Add ordering and pagination
	baseQuery += fmt.Sprintf(" ORDER BY i.created_at DESC LIMIT $%d OFFSET $%d", argIdx, argIdx+1)
	args = append(args, query.PageSize, offset)

	rows, err := db.Pool.Query(context.Background(), baseQuery, args...)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "查询物品失败"})
		return
	}
	defer rows.Close()

	items := []models.Item{}
	for rows.Next() {
		var item models.Item
		if err := rows.Scan(
			&item.ID, &item.Name, &item.CategoryID, &item.CategoryName,
			&item.Manufacturer, &item.UsageDesc,
			&item.ProductionDate, &item.ExpiryDate,
			&item.ImageURL, &item.OwnerID, &item.IsPrivate, &item.CreatedBy,
			&item.CreatedByName,
			&item.CreatedAt, &item.UpdatedAt,
		); err == nil {
			items = append(items, item)
		}
	}

	c.JSON(http.StatusOK, gin.H{
		"items":     items,
		"total":     total,
		"page":      query.Page,
		"page_size": query.PageSize,
	})
}

// GetItem returns a single item
func GetItem(c *gin.Context) {
	userID := middleware.GetUserID(c)
	itemID := c.Param("id")

	var item models.Item
	var ownerID uuid.UUID
	err := db.Pool.QueryRow(context.Background(),
		`SELECT i.id, i.name, i.category_id, c.name as category_name, 
			i.manufacturer, i.usage_desc, 
			i.production_date::text, i.expiry_date::text, 
			i.image_url, i.owner_id, i.is_private, i.created_by, 
			u.username as created_by_name,
			i.created_at, i.updated_at
		 FROM items i
		 LEFT JOIN categories c ON i.category_id = c.id
		 LEFT JOIN users u ON i.created_by = u.id
		 WHERE i.id = $1`,
		itemID,
	).Scan(
		&item.ID, &item.Name, &item.CategoryID, &item.CategoryName,
		&item.Manufacturer, &item.UsageDesc,
		&item.ProductionDate, &item.ExpiryDate,
		&item.ImageURL, &ownerID, &item.IsPrivate, &item.CreatedBy,
		&item.CreatedByName,
		&item.CreatedAt, &item.UpdatedAt,
	)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "物品不存在"})
		return
	}

	// Check access: user must be the owner or in the same group
	if !isItemAccessible(c, userID, ownerID) {
		c.JSON(http.StatusForbidden, gin.H{"error": "无权访问该物品"})
		return
	}

	item.OwnerID = ownerID
	c.JSON(http.StatusOK, gin.H{"item": item})
}

// UpdateItem updates an item
func UpdateItem(c *gin.Context) {
	userID := middleware.GetUserID(c)
	itemID := c.Param("id")

	var req models.UpdateItemRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "请求参数无效: " + err.Error()})
		return
	}

	// Validate dates
	prodDate, err := time.Parse("2006-01-02", req.ProductionDate)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "生产日期格式无效"})
		return
	}
	expDate, err := time.Parse("2006-01-02", req.ExpiryDate)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "过期日期格式无效"})
		return
	}
	if expDate.Before(prodDate) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "过期日期不能早于生产日期"})
		return
	}

	// Get existing item
	var existingOwnerID uuid.UUID
	var existingIsPrivate bool
	err = db.Pool.QueryRow(context.Background(),
		`SELECT owner_id, is_private FROM items WHERE id = $1`, itemID,
	).Scan(&existingOwnerID, &existingIsPrivate)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "物品不存在"})
		return
	}

	// Check access
	if !isItemAccessible(c, userID, existingOwnerID) {
		c.JSON(http.StatusForbidden, gin.H{"error": "无权修改该物品"})
		return
	}

	// Determine new owner if isPrivate changed
	isPrivate := existingIsPrivate
	if req.IsPrivate != nil {
		isPrivate = *req.IsPrivate
	}

	newOwnerID := existingOwnerID
	if req.IsPrivate != nil && *req.IsPrivate != existingIsPrivate {
		newOwnerID, err = getOwnerID(context.Background(), userID, isPrivate)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
	}

	// Check name uniqueness if name changed
	var existingName string
	db.Pool.QueryRow(context.Background(),
		`SELECT name FROM items WHERE id = $1`, itemID,
	).Scan(&existingName)
	if req.Name != existingName {
		var nameExists bool
		err = db.Pool.QueryRow(context.Background(),
			`SELECT EXISTS(SELECT 1 FROM items WHERE owner_id = $1 AND name = $2 AND id != $3)`,
			newOwnerID, req.Name, itemID,
		).Scan(&nameExists)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "检查物品名称失败"})
			return
		}
		if nameExists {
			c.JSON(http.StatusConflict, gin.H{"error": "同名物品已存在"})
			return
		}
	}

	// Update item
	_, err = db.Pool.Exec(context.Background(),
		`UPDATE items SET name = $1, category_id = $2, manufacturer = $3, usage_desc = $4, 
			production_date = $5, expiry_date = $6, image_url = $7, 
			owner_id = $8, is_private = $9, updated_at = NOW()
		 WHERE id = $10`,
		req.Name, req.CategoryID, req.Manufacturer, req.UsageDesc,
		req.ProductionDate, req.ExpiryDate, req.ImageURL,
		newOwnerID, isPrivate, itemID,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "更新物品失败"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "物品更新成功"})
}

// DeleteItem deletes an item
func DeleteItem(c *gin.Context) {
	userID := middleware.GetUserID(c)
	itemID := c.Param("id")

	// Get existing item
	var ownerID uuid.UUID
	err := db.Pool.QueryRow(context.Background(),
		`SELECT owner_id FROM items WHERE id = $1`, itemID,
	).Scan(&ownerID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "物品不存在"})
		return
	}

	// Check access
	if !isItemAccessible(c, userID, ownerID) {
		c.JSON(http.StatusForbidden, gin.H{"error": "无权删除该物品"})
		return
	}

	_, err = db.Pool.Exec(context.Background(),
		`DELETE FROM items WHERE id = $1`, itemID,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "删除物品失败"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "物品删除成功"})
}

// isItemAccessible checks if a user can access an item
func isItemAccessible(c *gin.Context, userID uuid.UUID, ownerID uuid.UUID) bool {
	// User owns the item directly
	if userID == ownerID {
		return true
	}

	// Check if owner is user's group
	var groupID *uuid.UUID
	err := db.Pool.QueryRow(context.Background(),
		`SELECT group_id FROM users WHERE id = $1`, userID,
	).Scan(&groupID)
	if err != nil || groupID == nil {
		return false
	}

	return *groupID == ownerID
}

// UploadImage handles image upload
func UploadImage(c *gin.Context) {
	file, err := c.FormFile("image")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "请选择图片文件"})
		return
	}

	// Generate unique filename
	ext := file.Filename[strings.LastIndex(file.Filename, "."):]
	filename := uuid.New().String() + ext
	filepath := "./uploads/" + filename

	if err := c.SaveUploadedFile(file, filepath); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "保存图片失败"})
		return
	}

	imageURL := "/uploads/" + filename
	c.JSON(http.StatusOK, gin.H{
		"message":   "图片上传成功",
		"image_url": imageURL,
	})
}
