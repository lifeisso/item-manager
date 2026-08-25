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
)

// ===== Maintenance Plans =====

// GetPlans returns all maintenance plans for the current user
func GetPlans(c *gin.Context) {
	userID := middleware.GetUserID(c)

	rows, err := db.Pool.Query(context.Background(), `
		SELECT mp.id, mp.name, mp.icon, mp.description, mp.user_id, mp.created_at, mp.updated_at,
			COALESCE(SUM(CASE WHEN mi.next_due_date <= CURRENT_DATE + INTERVAL '7 days' THEN 1 ELSE 0 END), 0) as due_count,
			COALESCE(COUNT(mi.id), 0) as total_count,
			MIN(mi.next_due_date) as next_due_date
		FROM maintenance_plans mp
		LEFT JOIN maintenance_items mi ON mi.plan_id = mp.id
		WHERE mp.user_id = $1
		GROUP BY mp.id
		ORDER BY mp.created_at ASC
	`, userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "查询计划失败"})
		return
	}
	defer rows.Close()

	plans := []models.MaintenancePlan{}
	for rows.Next() {
		var p models.MaintenancePlan
		var nextDue *time.Time
		if err := rows.Scan(&p.ID, &p.Name, &p.Icon, &p.Description, &p.UserID, &p.CreatedAt, &p.UpdatedAt,
			&p.DueCount, &p.TotalCount, &nextDue); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "解析计划失败"})
			return
		}
		if nextDue != nil {
			s := nextDue.Format("2006-01-02")
			p.NextDueDate = &s
		}
		plans = append(plans, p)
	}

	c.JSON(http.StatusOK, gin.H{"plans": plans})
}

// CreatePlan creates a new maintenance plan
func CreatePlan(c *gin.Context) {
	userID := middleware.GetUserID(c)

	var req models.CreatePlanRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "请求参数无效: " + err.Error()})
		return
	}

	if req.Icon == "" {
		req.Icon = "🔧"
	}

	var planID uuid.UUID
	err := db.Pool.QueryRow(context.Background(), `
		INSERT INTO maintenance_plans (user_id, name, icon, description)
		VALUES ($1, $2, $3, $4)
		RETURNING id
	`, userID, req.Name, req.Icon, req.Description).Scan(&planID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "创建计划失败"})
		return
	}

	// Handle templates
	if req.Template != "" {
		templateItems := getTemplateItems(req.Template)
		for i, item := range templateItems {
			nextDue := time.Now().AddDate(0, 0, item.CycleDays)
			_, err := db.Pool.Exec(context.Background(), `
				INSERT INTO maintenance_items (plan_id, name, cycle_days, next_due_date, sort_order)
				VALUES ($1, $2, $3, $4, $5)
			`, planID, item.Name, item.CycleDays, nextDue, i+1)
			if err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": "创建模板保养项失败"})
				return
			}
		}
	}

	c.JSON(http.StatusOK, gin.H{"message": "创建成功", "id": planID})
}

type templateItem struct {
	Name      string
	CycleDays int
}

func getTemplateItems(template string) []templateItem {
	switch template {
	case "water_purifier":
		return []templateItem{
			{"1级滤芯（PP棉）", 30},
			{"2级滤芯（前置炭）", 90},
			{"3级滤芯（超滤/RO）", 180},
			{"4级滤芯（后置炭）", 365},
			{"5级滤芯（精滤）", 730},
		}
	case "car":
		return []templateItem{
			{"机油", 180},
			{"机滤", 180},
		}
	default:
		return nil
	}
}

// UpdatePlan updates a maintenance plan
func UpdatePlan(c *gin.Context) {
	userID := middleware.GetUserID(c)
	planID := c.Param("id")

	var req models.UpdatePlanRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "请求参数无效"})
		return
	}

	result, err := db.Pool.Exec(context.Background(), `
		UPDATE maintenance_plans SET name = $1, icon = $2, description = $3, updated_at = NOW()
		WHERE id = $4 AND user_id = $5
	`, req.Name, req.Icon, req.Description, planID, userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "更新计划失败"})
		return
	}
	if result.RowsAffected() == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "计划不存在"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "更新成功"})
}

// DeletePlan deletes a maintenance plan (cascades to items)
func DeletePlan(c *gin.Context) {
	userID := middleware.GetUserID(c)
	planID := c.Param("id")

	result, err := db.Pool.Exec(context.Background(), `
		DELETE FROM maintenance_plans WHERE id = $1 AND user_id = $2
	`, planID, userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "删除计划失败"})
		return
	}
	if result.RowsAffected() == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "计划不存在"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "删除成功"})
}

// ===== Maintenance Items =====

// GetMaintItems returns all maintenance items for a plan
func GetMaintItems(c *gin.Context) {
	userID := middleware.GetUserID(c)
	planID := c.Param("planId")

	rows, err := db.Pool.Query(context.Background(), `
		SELECT mi.id, mi.plan_id, mp.name as plan_name, mp.icon as plan_icon,
			mi.name, mi.cycle_days, mi.last_done_date, mi.next_due_date, mi.sort_order,
			mi.created_at, mi.updated_at,
			CASE WHEN mi.next_due_date <= CURRENT_DATE THEN true ELSE false END as is_overdue,
			(mi.next_due_date - CURRENT_DATE) as days_until_due
		FROM maintenance_items mi
		JOIN maintenance_plans mp ON mi.plan_id = mp.id
		WHERE mi.plan_id = $1 AND mp.user_id = $2
		ORDER BY mi.sort_order ASC, mi.created_at ASC
	`, planID, userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "查询保养项失败"})
		return
	}
	defer rows.Close()

	items := []models.MaintenanceItem{}
	for rows.Next() {
		var item models.MaintenanceItem
		var lastDone *time.Time
		var nextDue time.Time
		var daysUntilDue int
		if err := rows.Scan(&item.ID, &item.PlanID, &item.PlanName, &item.PlanIcon,
			&item.Name, &item.CycleDays, &lastDone, &nextDue, &item.SortOrder,
			&item.CreatedAt, &item.UpdatedAt, &item.IsOverdue, &daysUntilDue); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "解析保养项失败"})
			return
		}
		if lastDone != nil {
			s := lastDone.Format("2006-01-02")
			item.LastDoneDate = &s
		}
		item.NextDueDate = nextDue.Format("2006-01-02")
		item.DaysUntilDue = daysUntilDue
		items = append(items, item)
	}

	c.JSON(http.StatusOK, gin.H{"items": items})
}

// CreateMaintItem creates a new maintenance item
func CreateMaintItem(c *gin.Context) {
	userID := middleware.GetUserID(c)
	planID := c.Param("planId")

	// Verify plan belongs to user
	var count int
	err := db.Pool.QueryRow(context.Background(),
		"SELECT COUNT(*) FROM maintenance_plans WHERE id = $1 AND user_id = $2",
		planID, userID).Scan(&count)
	if err != nil || count == 0 {
		c.JSON(http.StatusForbidden, gin.H{"error": "无权操作此计划"})
		return
	}

	var req models.CreateMaintItemRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "请求参数无效: " + err.Error()})
		return
	}

	// Calculate next_due_date
	var nextDue time.Time
	if req.LastDoneDate != "" {
		lastDone, err := time.Parse("2006-01-02", req.LastDoneDate)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "日期格式无效，应为YYYY-MM-DD"})
			return
		}
		nextDue = lastDone.AddDate(0, 0, req.CycleDays)
	} else {
		nextDue = time.Now().AddDate(0, 0, req.CycleDays)
	}

	var itemID uuid.UUID
	err = db.Pool.QueryRow(context.Background(), `
		INSERT INTO maintenance_items (plan_id, name, cycle_days, last_done_date, next_due_date, sort_order)
		VALUES ($1, $2, $3, $4, $5, $6)
		RETURNING id
	`, planID, req.Name, req.CycleDays, req.LastDoneDate, nextDue, req.SortOrder).Scan(&itemID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "创建保养项失败"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "创建成功", "id": itemID})
}

// UpdateMaintItem updates a maintenance item
func UpdateMaintItem(c *gin.Context) {
	userID := middleware.GetUserID(c)
	itemID := c.Param("id")

	var req models.UpdateMaintItemRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "请求参数无效: " + err.Error()})
		return
	}

	// Verify item belongs to user's plan
	var planID string
	err := db.Pool.QueryRow(context.Background(), `
		SELECT mi.plan_id FROM maintenance_items mi
		JOIN maintenance_plans mp ON mi.plan_id = mp.id
		WHERE mi.id = $1 AND mp.user_id = $2
	`, itemID, userID).Scan(&planID)
	if err != nil {
		c.JSON(http.StatusForbidden, gin.H{"error": "无权操作此保养项"})
		return
	}

	// Calculate next_due_date
	var nextDue time.Time
	var lastDoneDate *string
	if req.LastDoneDate != "" {
		lastDone, err := time.Parse("2006-01-02", req.LastDoneDate)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "日期格式无效，应为YYYY-MM-DD"})
			return
		}
		nextDue = lastDone.AddDate(0, 0, req.CycleDays)
		lastDoneDate = &req.LastDoneDate
	} else {
		nextDue = time.Now().AddDate(0, 0, req.CycleDays)
	}

	_, err = db.Pool.Exec(context.Background(), `
		UPDATE maintenance_items SET name = $1, cycle_days = $2, last_done_date = $3, next_due_date = $4, sort_order = $5, updated_at = NOW()
		WHERE id = $6
	`, req.Name, req.CycleDays, lastDoneDate, nextDue, req.SortOrder, itemID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "更新保养项失败"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "更新成功"})
}

// DeleteMaintItem deletes a maintenance item
func DeleteMaintItem(c *gin.Context) {
	userID := middleware.GetUserID(c)
	itemID := c.Param("id")

	result, err := db.Pool.Exec(context.Background(), `
		DELETE FROM maintenance_items mi USING maintenance_plans mp
		WHERE mi.plan_id = mp.id AND mi.id = $1 AND mp.user_id = $2
	`, itemID, userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "删除保养项失败"})
		return
	}
	if result.RowsAffected() == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "保养项不存在"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "删除成功"})
}

// MarkItemDone marks a maintenance item as done (resets the cycle)
func MarkItemDone(c *gin.Context) {
	userID := middleware.GetUserID(c)
	itemID := c.Param("id")

	// Verify item belongs to user's plan
	var planID string
	err := db.Pool.QueryRow(context.Background(), `
		SELECT mi.plan_id FROM maintenance_items mi
		JOIN maintenance_plans mp ON mi.plan_id = mp.id
		WHERE mi.id = $1 AND mp.user_id = $2
	`, itemID, userID).Scan(&planID)
	if err != nil {
		c.JSON(http.StatusForbidden, gin.H{"error": "无权操作此保养项"})
		return
	}

	// Update: last_done_date = today, next_due_date = today + cycle_days
	_, err = db.Pool.Exec(context.Background(), `
		UPDATE maintenance_items
		SET last_done_date = CURRENT_DATE,
		    next_due_date = CURRENT_DATE + cycle_days * INTERVAL '1 day',
		    updated_at = NOW()
		WHERE id = $1
	`, itemID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "标记完成失败"})
		return
	}

	// Insert a completion record
	_, err = db.Pool.Exec(context.Background(), `
		INSERT INTO maintenance_records (item_id, plan_id, done_date)
		VALUES ($1, $2, CURRENT_DATE)
	`, itemID, planID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "保存记录失败"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "标记完成"})
}

// GetDueItems returns maintenance items due within N days
func GetDueItems(c *gin.Context) {
	userID := middleware.GetUserID(c)
	days := c.DefaultQuery("days", "30")

	rows, err := db.Pool.Query(context.Background(), `
		SELECT mi.id, mi.plan_id, mp.name as plan_name, mp.icon as plan_icon,
			mi.name, mi.cycle_days, mi.last_done_date, mi.next_due_date, mi.sort_order,
			mi.created_at, mi.updated_at,
			CASE WHEN mi.next_due_date <= CURRENT_DATE THEN true ELSE false END as is_overdue,
			(mi.next_due_date - CURRENT_DATE) as days_until_due
		FROM maintenance_items mi
		JOIN maintenance_plans mp ON mi.plan_id = mp.id
		WHERE mp.user_id = $1 AND mi.next_due_date <= CURRENT_DATE + $2::integer * INTERVAL '1 day'
		ORDER BY mi.next_due_date ASC
	`, userID, days)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "查询到期项失败"})
		return
	}
	defer rows.Close()

	items := []models.MaintenanceItem{}
	for rows.Next() {
		var item models.MaintenanceItem
		var lastDone *time.Time
		var nextDue time.Time
		var daysUntilDue int
		if err := rows.Scan(&item.ID, &item.PlanID, &item.PlanName, &item.PlanIcon,
			&item.Name, &item.CycleDays, &lastDone, &nextDue, &item.SortOrder,
			&item.CreatedAt, &item.UpdatedAt, &item.IsOverdue, &daysUntilDue); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "解析到期项失败"})
			return
		}
		if lastDone != nil {
			s := lastDone.Format("2006-01-02")
			item.LastDoneDate = &s
		}
		item.NextDueDate = nextDue.Format("2006-01-02")
		item.DaysUntilDue = daysUntilDue
		items = append(items, item)
	}

	c.JSON(http.StatusOK, gin.H{"items": items, "count": len(items)})
}

// ===== Maintenance Records =====

// GetPlanRecords returns all maintenance records for a plan
func GetPlanRecords(c *gin.Context) {
	userID := middleware.GetUserID(c)
	planID := c.Param("planId")

	rows, err := db.Pool.Query(context.Background(), `
		SELECT mr.id, mr.item_id, mr.plan_id, mi.name as item_name, mp.name as plan_name, mp.icon as plan_icon,
			mr.done_date, mr.note, mr.created_at
		FROM maintenance_records mr
		JOIN maintenance_items mi ON mr.item_id = mi.id
		JOIN maintenance_plans mp ON mr.plan_id = mp.id
		WHERE mr.plan_id = $1 AND mp.user_id = $2
		ORDER BY mr.done_date DESC, mr.created_at DESC
	`, planID, userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "查询记录失败"})
		return
	}
	defer rows.Close()

	records := []models.MaintenanceRecord{}
	for rows.Next() {
		var r models.MaintenanceRecord
		var doneDate time.Time
		if err := rows.Scan(&r.ID, &r.ItemID, &r.PlanID, &r.ItemName, &r.PlanName, &r.PlanIcon,
			&doneDate, &r.Note, &r.CreatedAt); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "解析记录失败"})
			return
		}
		r.DoneDate = doneDate.Format("2006-01-02")
		records = append(records, r)
	}

	c.JSON(http.StatusOK, gin.H{"records": records})
}

// GetAllRecords returns all maintenance records for the current user
func GetAllRecords(c *gin.Context) {
	userID := middleware.GetUserID(c)

	rows, err := db.Pool.Query(context.Background(), `
		SELECT mr.id, mr.item_id, mr.plan_id, mi.name as item_name, mp.name as plan_name, mp.icon as plan_icon,
			mr.done_date, mr.note, mr.created_at
		FROM maintenance_records mr
		JOIN maintenance_items mi ON mr.item_id = mi.id
		JOIN maintenance_plans mp ON mr.plan_id = mp.id
		WHERE mp.user_id = $1
		ORDER BY mr.done_date DESC, mr.created_at DESC
	`, userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "查询记录失败"})
		return
	}
	defer rows.Close()

	records := []models.MaintenanceRecord{}
	for rows.Next() {
		var r models.MaintenanceRecord
		var doneDate time.Time
		if err := rows.Scan(&r.ID, &r.ItemID, &r.PlanID, &r.ItemName, &r.PlanName, &r.PlanIcon,
			&doneDate, &r.Note, &r.CreatedAt); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "解析记录失败"})
			return
		}
		r.DoneDate = doneDate.Format("2006-01-02")
		records = append(records, r)
	}

	c.JSON(http.StatusOK, gin.H{"records": records})
}

// DeleteRecord deletes a maintenance record
func DeleteRecord(c *gin.Context) {
	userID := middleware.GetUserID(c)
	recordID := c.Param("id")

	result, err := db.Pool.Exec(context.Background(), `
		DELETE FROM maintenance_records mr USING maintenance_plans mp
		WHERE mr.plan_id = mp.id AND mr.id = $1 AND mp.user_id = $2
	`, recordID, userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "删除记录失败"})
		return
	}
	if result.RowsAffected() == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "记录不存在"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "删除成功"})
}
