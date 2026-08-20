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

// getGroupID returns the user's group_id (nil if not in a group)
func getGroupID(ctx context.Context, userID uuid.UUID) (*uuid.UUID, error) {
	var groupID *uuid.UUID
	err := db.Pool.QueryRow(ctx,
		`SELECT group_id FROM users WHERE id = $1`, userID,
	).Scan(&groupID)
	if err != nil {
		return nil, fmt.Errorf("查询用户组信息失败")
	}
	return groupID, nil
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

	// Determine ownergroup_id:
	// - Private item: ownergroup_id = NULL
	// - Shared item: ownergroup_id = user's group_id (must have a group)
	var ownergroupID *uuid.UUID
	if !req.IsPrivate {
		groupID, err := getGroupID(context.Background(), userID)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		if groupID == nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "共享物品需要先加入一个组"})
			return
		}
		ownergroupID = groupID
	}

	// Check item name uniqueness within owner
	var nameExists bool
	err = db.Pool.QueryRow(context.Background(),
		`SELECT EXISTS(SELECT 1 FROM items WHERE owner_id = $1 AND name = $2)`,
		userID, req.Name,
	).Scan(&nameExists)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "检查物品名称失败"})
		return
	}
	if nameExists {
		c.JSON(http.StatusConflict, gin.H{"error": "已存在同名物品"})
		return
	}

	// Insert item: owner_id is always the creator, ownergroup_id indicates group sharing
	var itemID uuid.UUID
	err = db.Pool.QueryRow(context.Background(),
		`INSERT INTO items (name, category_id, manufacturer, usage_desc, production_date, expiry_date, 
			image_url, owner_id, ownergroup_id, is_private, created_by) 
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id`,
		req.Name, req.CategoryID, req.Manufacturer, req.UsageDesc,
		req.ProductionDate, req.ExpiryDate, req.ImageURL,
		userID, ownergroupID, req.IsPrivate, userID,
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

	// Get user's group_id
	groupID, _ := getGroupID(context.Background(), userID)

	// Build query based on owner filter
	// "self" = items created by user (both private and shared)
	// "group" = shared items in user's group (ownergroup_id = group_id)
	// default = all items accessible to user (self + group shared)
	baseQuery := `
		SELECT i.id, i.name, i.category_id, c.name as category_name, 
			i.manufacturer, i.usage_desc, 
			i.production_date::text, i.expiry_date::text, 
			i.image_url, i.owner_id, i.ownergroup_id, i.is_private, i.created_by, 
			u.username as created_by_name,
			g.username as ownergroup_name,
			i.created_at, i.updated_at
		FROM items i
		LEFT JOIN categories c ON i.category_id = c.id
		LEFT JOIN users u ON i.created_by = u.id
		LEFT JOIN users g ON i.ownergroup_id = g.id
		WHERE i.deleted_at IS NULL AND `

	var args []interface{}
	argIdx := 1

	switch query.Owner {
	case "self":
		// Items created by this user
		baseQuery += fmt.Sprintf("i.owner_id = $%d", argIdx)
		args = append(args, userID)
		argIdx++
	case "group":
		// Shared items in the group (ownergroup_id = group_id)
		if groupID == nil {
			c.JSON(http.StatusOK, gin.H{
				"items":     []interface{}{},
				"total":     0,
				"page":      query.Page,
				"page_size": query.PageSize,
			})
			return
		}
		baseQuery += fmt.Sprintf("i.ownergroup_id = $%d", argIdx)
		args = append(args, *groupID)
		argIdx++
	default:
		// All accessible items: own items + group shared items
		if groupID != nil {
			baseQuery += fmt.Sprintf("(i.owner_id = $%d OR i.ownergroup_id = $%d)", argIdx, argIdx+1)
			args = append(args, userID, *groupID)
			argIdx += 2
		} else {
			baseQuery += fmt.Sprintf("i.owner_id = $%d", argIdx)
			args = append(args, userID)
			argIdx++
		}
	}

	// Add category filter - match by category name instead of ID
	// This allows group members to see shared items with the same category name
	// even if the category IDs differ between users
	if query.CategoryID > 0 {
		var categoryName string
		err := db.Pool.QueryRow(context.Background(),
			`SELECT name FROM categories WHERE id = $1`, query.CategoryID,
		).Scan(&categoryName)
		if err == nil && categoryName != "" {
			baseQuery += fmt.Sprintf(" AND c.name = $%d", argIdx)
			args = append(args, categoryName)
			argIdx++
		} else {
			// Category not found, return empty
			baseQuery += fmt.Sprintf(" AND i.category_id = $%d", argIdx)
			args = append(args, query.CategoryID)
			argIdx++
		}
	}

	// Add keyword search
	if query.Keyword != "" {
		baseQuery += fmt.Sprintf(" AND (i.name ILIKE $%d OR i.manufacturer ILIKE $%d OR i.usage_desc ILIKE $%d)",
			argIdx, argIdx+1, argIdx+2)
		keyword := "%" + query.Keyword + "%"
		args = append(args, keyword, keyword, keyword)
		argIdx += 3
	}

	// Count total - reuse the same WHERE logic
	countQuery := `SELECT COUNT(*) FROM items i LEFT JOIN categories c ON i.category_id = c.id LEFT JOIN users u ON i.created_by = u.id LEFT JOIN users g ON i.ownergroup_id = g.id WHERE i.deleted_at IS NULL AND `
	countWhere := ""
	countArgs := []interface{}{}
	cargIdx := 1

	switch query.Owner {
	case "self":
		countWhere += fmt.Sprintf("i.owner_id = $%d", cargIdx)
		countArgs = append(countArgs, userID)
		cargIdx++
	case "group":
		if groupID != nil {
			countWhere += fmt.Sprintf("i.ownergroup_id = $%d", cargIdx)
			countArgs = append(countArgs, *groupID)
			cargIdx++
		}
	default:
		if groupID != nil {
			countWhere += fmt.Sprintf("(i.owner_id = $%d OR i.ownergroup_id = $%d)", cargIdx, cargIdx+1)
			countArgs = append(countArgs, userID, *groupID)
			cargIdx += 2
		} else {
			countWhere += fmt.Sprintf("i.owner_id = $%d", cargIdx)
			countArgs = append(countArgs, userID)
			cargIdx++
		}
	}
	if query.CategoryID > 0 {
		var categoryName string
		err := db.Pool.QueryRow(context.Background(),
			`SELECT name FROM categories WHERE id = $1`, query.CategoryID,
		).Scan(&categoryName)
		if err == nil && categoryName != "" {
			countWhere += fmt.Sprintf(" AND c.name = $%d", cargIdx)
			countArgs = append(countArgs, categoryName)
			cargIdx++
		} else {
			countWhere += fmt.Sprintf(" AND i.category_id = $%d", cargIdx)
			countArgs = append(countArgs, query.CategoryID)
			cargIdx++
		}
	}
	if query.Keyword != "" {
		countWhere += fmt.Sprintf(" AND (i.name ILIKE $%d OR i.manufacturer ILIKE $%d OR i.usage_desc ILIKE $%d)",
			cargIdx, cargIdx+1, cargIdx+2)
		keyword := "%" + query.Keyword + "%"
		countArgs = append(countArgs, keyword, keyword, keyword)
	}

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
		var ownergroupName *string
		if err := rows.Scan(
			&item.ID, &item.Name, &item.CategoryID, &item.CategoryName,
			&item.Manufacturer, &item.UsageDesc,
			&item.ProductionDate, &item.ExpiryDate,
			&item.ImageURL, &item.OwnerID, &item.OwnergroupID, &item.IsPrivate, &item.CreatedBy,
			&item.CreatedByName,
			&ownergroupName,
			&item.CreatedAt, &item.UpdatedAt,
		); err == nil {
			if ownergroupName != nil {
				item.OwnergroupName = *ownergroupName
			}
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
	var ownergroupName *string
	err := db.Pool.QueryRow(context.Background(),
		`SELECT i.id, i.name, i.category_id, c.name as category_name, 
			i.manufacturer, i.usage_desc, 
			i.production_date::text, i.expiry_date::text, 
			i.image_url, i.owner_id, i.ownergroup_id, i.is_private, i.created_by, 
			u.username as created_by_name,
			g.username as ownergroup_name,
			i.created_at, i.updated_at
		 FROM items i
		 LEFT JOIN categories c ON i.category_id = c.id
		 LEFT JOIN users u ON i.created_by = u.id
		 LEFT JOIN users g ON i.ownergroup_id = g.id
		 WHERE i.id = $1`,
		itemID,
	).Scan(
		&item.ID, &item.Name, &item.CategoryID, &item.CategoryName,
		&item.Manufacturer, &item.UsageDesc,
		&item.ProductionDate, &item.ExpiryDate,
		&item.ImageURL, &item.OwnerID, &item.OwnergroupID, &item.IsPrivate, &item.CreatedBy,
		&item.CreatedByName,
		&ownergroupName,
		&item.CreatedAt, &item.UpdatedAt,
	)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "物品不存在"})
		return
	}

	if ownergroupName != nil {
		item.OwnergroupName = *ownergroupName
	}

	// Check access: user must be the owner or in the same group
	if !isItemAccessible(userID, item.OwnerID, item.OwnergroupID) {
		c.JSON(http.StatusForbidden, gin.H{"error": "无权访问该物品"})
		return
	}

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
	var existingOwnergroupID *uuid.UUID
	var existingIsPrivate bool
	err = db.Pool.QueryRow(context.Background(),
		`SELECT owner_id, ownergroup_id, is_private FROM items WHERE id = $1`, itemID,
	).Scan(&existingOwnerID, &existingOwnergroupID, &existingIsPrivate)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "物品不存在"})
		return
	}

	// Check access
	if !isItemAccessible(userID, existingOwnerID, existingOwnergroupID) {
		c.JSON(http.StatusForbidden, gin.H{"error": "无权修改该物品"})
		return
	}

	// Determine new ownergroup_id if isPrivate changed
	isPrivate := existingIsPrivate
	var newOwnergroupID *uuid.UUID = existingOwnergroupID

	if req.IsPrivate != nil && *req.IsPrivate != existingIsPrivate {
		isPrivate = *req.IsPrivate
		if isPrivate {
			// Switching to private: clear group
			newOwnergroupID = nil
		} else {
			// Switching to shared: set group
			groupID, err := getGroupID(context.Background(), userID)
			if err != nil || groupID == nil {
				c.JSON(http.StatusBadRequest, gin.H{"error": "共享物品需要先加入一个组"})
				return
			}
			newOwnergroupID = groupID
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
			existingOwnerID, req.Name, itemID,
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
			ownergroup_id = $8, is_private = $9, updated_at = NOW()
		 WHERE id = $10`,
		req.Name, req.CategoryID, req.Manufacturer, req.UsageDesc,
		req.ProductionDate, req.ExpiryDate, req.ImageURL,
		newOwnergroupID, isPrivate, itemID,
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
	var ownergroupID *uuid.UUID
	err := db.Pool.QueryRow(context.Background(),
		`SELECT owner_id, ownergroup_id FROM items WHERE id = $1 AND deleted_at IS NULL`, itemID,
	).Scan(&ownerID, &ownergroupID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "物品不存在"})
		return
	}

	// Check access
	if !isItemAccessible(userID, ownerID, ownergroupID) {
		c.JSON(http.StatusForbidden, gin.H{"error": "无权删除该物品"})
		return
	}

	// Soft delete - move to recycle bin
	_, err = db.Pool.Exec(context.Background(),
		`UPDATE items SET deleted_at = NOW() WHERE id = $1`, itemID,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "删除物品失败"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "物品已移入废物站"})
}

// isItemAccessible checks if a user can access an item
// Accessible if: user is the owner (owner_id) OR user's group matches ownergroup_id
func isItemAccessible(userID uuid.UUID, ownerID uuid.UUID, ownergroupID *uuid.UUID) bool {
	// User is the creator/owner
	if userID == ownerID {
		return true
	}

	// Check if item is shared with user's group
	if ownergroupID == nil {
		return false // Private item, only owner can access
	}

	// Get user's group
	userGroupID, err := getGroupID(context.Background(), userID)
	if err != nil || userGroupID == nil {
		return false // User has no group
	}

	return *userGroupID == *ownergroupID
}

// GetExpiringItems returns items expiring within N days (default 30), including already expired
func GetExpiringItems(c *gin.Context) {
	userID := middleware.GetUserID(c)

	days := 30
	if d := c.Query("days"); d != "" {
		if n, err := fmt.Sscanf(d, "%d", &days); err != nil || n != 1 || days < 1 || days > 365 {
			days = 30
		}
	}

	// Get user's group_id
	groupID, _ := getGroupID(context.Background(), userID)

	// Query items expiring within N days OR already expired (expiry_date <= NOW + N days)
	// Includes items that have already passed their expiry date
	query := `
		SELECT i.id, i.name, c.name as category_name,
			i.expiry_date::text, i.is_private,
			u.username as created_by_name,
			g.username as ownergroup_name
		FROM items i
		LEFT JOIN categories c ON i.category_id = c.id
		LEFT JOIN users u ON i.created_by = u.id
		LEFT JOIN users g ON i.ownergroup_id = g.id
		WHERE i.expiry_date <= NOW() + INTERVAL '1 day' * $1
		AND i.deleted_at IS NULL
	`
	var args []interface{}
	args = append(args, days)
	argIdx := 2

	if groupID != nil {
		query += fmt.Sprintf(" AND (i.owner_id = $%d OR i.ownergroup_id = $%d)", argIdx, argIdx+1)
		args = append(args, userID, *groupID)
	} else {
		query += fmt.Sprintf(" AND i.owner_id = $%d", argIdx)
		args = append(args, userID)
	}

	query += " ORDER BY i.expiry_date ASC LIMIT 50"

	rows, err := db.Pool.Query(context.Background(), query, args...)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "查询过期物品失败"})
		return
	}
	defer rows.Close()

	type ExpiringItem struct {
		ID             uuid.UUID `json:"id"`
		Name           string    `json:"name"`
		CategoryName   string    `json:"category_name"`
		ExpiryDate     string    `json:"expiry_date"`
		IsPrivate      bool      `json:"is_private"`
		OwnergroupName string    `json:"ownergroup_name"`
		CreatedByName  string    `json:"created_by_name"`
		DaysLeft       int       `json:"days_left"`
	}

	items := []ExpiringItem{}
	for rows.Next() {
		var item ExpiringItem
		var ownergroupName *string
		var catName *string

		if err := rows.Scan(
			&item.ID, &item.Name, &catName,
			&item.ExpiryDate, &item.IsPrivate,
			&item.CreatedByName,
			&ownergroupName,
		); err == nil {
			if catName != nil {
				item.CategoryName = *catName
			}
			if ownergroupName != nil {
				item.OwnergroupName = *ownergroupName
			}
			// Calculate days left (negative means already expired)
			expDate, _ := time.Parse("2006-01-02", item.ExpiryDate)
			now := time.Now()
			daysLeft := int(expDate.Sub(now).Hours() / 24)
			item.DaysLeft = daysLeft
			items = append(items, item)
		}
	}

	c.JSON(http.StatusOK, gin.H{
		"items": items,
		"days":  days,
	})
}

// GetRecycleBin returns soft-deleted items for the current user
func GetRecycleBin(c *gin.Context) {
	userID := middleware.GetUserID(c)
	groupID, _ := getGroupID(context.Background(), userID)

	query := `
		SELECT i.id, i.name, i.category_id, c.name as category_name,
			i.manufacturer, i.usage_desc,
			i.production_date::text, i.expiry_date::text,
			i.image_url, i.owner_id, i.ownergroup_id, i.is_private, i.created_by,
			u.username as created_by_name,
			g.username as ownergroup_name,
			i.deleted_at::text
		FROM items i
		LEFT JOIN categories c ON i.category_id = c.id
		LEFT JOIN users u ON i.created_by = u.id
		LEFT JOIN users g ON i.ownergroup_id = g.id
		WHERE i.deleted_at IS NOT NULL AND `

	var args []interface{}
	argIdx := 1

	if groupID != nil {
		query += fmt.Sprintf("(i.owner_id = $%d OR i.ownergroup_id = $%d)", argIdx, argIdx+1)
		args = append(args, userID, *groupID)
	} else {
		query += fmt.Sprintf("i.owner_id = $%d", argIdx)
		args = append(args, userID)
	}

	query += " ORDER BY i.deleted_at DESC LIMIT 100"

	rows, err := db.Pool.Query(context.Background(), query, args...)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "查询废物站失败"})
		return
	}
	defer rows.Close()

	type RecycleBinItem struct {
		ID             uuid.UUID  `json:"id"`
		Name           string     `json:"name"`
		CategoryID     *int       `json:"category_id"`
		CategoryName   string     `json:"category_name"`
		Manufacturer   string     `json:"manufacturer"`
		UsageDesc      string     `json:"usage_desc"`
		ProductionDate string     `json:"production_date"`
		ExpiryDate     string     `json:"expiry_date"`
		ImageURL       string     `json:"image_url"`
		OwnerID        uuid.UUID  `json:"owner_id"`
		OwnergroupID   *uuid.UUID `json:"ownergroup_id"`
		IsPrivate      bool       `json:"is_private"`
		CreatedBy      uuid.UUID  `json:"created_by"`
		CreatedByName  string     `json:"created_by_name"`
		OwnergroupName string     `json:"ownergroup_name"`
		DeletedAt      string     `json:"deleted_at"`
	}

	var items []RecycleBinItem
	for rows.Next() {
		var item RecycleBinItem
		var catName *string
		var ownergroupName *string
		if err := rows.Scan(
			&item.ID, &item.Name, &item.CategoryID, &catName,
			&item.Manufacturer, &item.UsageDesc,
			&item.ProductionDate, &item.ExpiryDate,
			&item.ImageURL, &item.OwnerID, &item.OwnergroupID, &item.IsPrivate, &item.CreatedBy,
			&item.CreatedByName,
			&ownergroupName,
			&item.DeletedAt,
		); err == nil {
			if catName != nil {
				item.CategoryName = *catName
			}
			if ownergroupName != nil {
				item.OwnergroupName = *ownergroupName
			}
			items = append(items, item)
		}
	}

	if items == nil {
		items = []RecycleBinItem{}
	}
	c.JSON(http.StatusOK, gin.H{"items": items})
}

// RestoreItem restores a soft-deleted item
func RestoreItem(c *gin.Context) {
	userID := middleware.GetUserID(c)
	itemID := c.Param("id")

	// Check item exists and is in recycle bin
	var ownerID uuid.UUID
	var ownergroupID *uuid.UUID
	err := db.Pool.QueryRow(context.Background(),
		`SELECT owner_id, ownergroup_id FROM items WHERE id = $1 AND deleted_at IS NOT NULL`, itemID,
	).Scan(&ownerID, &ownergroupID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "废物站中不存在该物品"})
		return
	}

	if !isItemAccessible(userID, ownerID, ownergroupID) {
		c.JSON(http.StatusForbidden, gin.H{"error": "无权恢复该物品"})
		return
	}

	_, err = db.Pool.Exec(context.Background(),
		`UPDATE items SET deleted_at = NULL WHERE id = $1`, itemID,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "恢复物品失败"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "物品已恢复"})
}

// PermanentDeleteItem permanently deletes an item from recycle bin
func PermanentDeleteItem(c *gin.Context) {
	userID := middleware.GetUserID(c)
	itemID := c.Param("id")

	// Check item exists and is in recycle bin
	var ownerID uuid.UUID
	var ownergroupID *uuid.UUID
	err := db.Pool.QueryRow(context.Background(),
		`SELECT owner_id, ownergroup_id FROM items WHERE id = $1 AND deleted_at IS NOT NULL`, itemID,
	).Scan(&ownerID, &ownergroupID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "废物站中不存在该物品"})
		return
	}

	if !isItemAccessible(userID, ownerID, ownergroupID) {
		c.JSON(http.StatusForbidden, gin.H{"error": "无权删除该物品"})
		return
	}

	_, err = db.Pool.Exec(context.Background(),
		`DELETE FROM items WHERE id = $1`, itemID,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "永久删除物品失败"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "物品已永久删除"})
}

// EmptyRecycleBin permanently deletes all items in recycle bin for the current user
func EmptyRecycleBin(c *gin.Context) {
	userID := middleware.GetUserID(c)
	groupID, _ := getGroupID(context.Background(), userID)

	var query string
	var args []interface{}

	if groupID != nil {
		query = `DELETE FROM items WHERE deleted_at IS NOT NULL AND (owner_id = $1 OR ownergroup_id = $2)`
		args = append(args, userID, *groupID)
	} else {
		query = `DELETE FROM items WHERE deleted_at IS NOT NULL AND owner_id = $1`
		args = append(args, userID)
	}

	tag, err := db.Pool.Exec(context.Background(), query, args...)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "清空废物站失败"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "废物站已清空", "deleted": tag.RowsAffected()})
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
