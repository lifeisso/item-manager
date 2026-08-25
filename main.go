package main

import (
	"log"
	"net/http"
	"os"

	"item-manager/db"
	"item-manager/handlers"
	"item-manager/middleware"

	"github.com/gin-gonic/gin"
)

func main() {
	// Connect to database
	if err := db.Connect(); err != nil {
		log.Fatalf("Failed to connect to database: %v", err)
	}
	defer db.Close()

	// Run migrations
	if err := db.Migrate(); err != nil {
		log.Fatalf("Failed to run migrations: %v", err)
	}

	// Create uploads directory
	if err := os.MkdirAll("./uploads", 0755); err != nil {
		log.Fatalf("Failed to create uploads directory: %v", err)
	}

	// Set Gin mode
	if os.Getenv("GIN_MODE") == "" {
		gin.SetMode(gin.DebugMode)
	}

	r := gin.Default()

	// Serve static files
	r.Static("/uploads", "./uploads")
	r.Static("/static", "./static")

	// CORS middleware
	r.Use(func(c *gin.Context) {
		c.Header("Access-Control-Allow-Origin", "*")
		c.Header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		c.Header("Access-Control-Allow-Headers", "Content-Type, Authorization")
		if c.Request.Method == "OPTIONS" {
			c.AbortWithStatus(http.StatusNoContent)
			return
		}
		c.Next()
	})

	// Serve frontend
	r.GET("/", func(c *gin.Context) {
		c.File("./static/index.html")
	})

	// API routes
	api := r.Group("/api")
	{
		// Auth routes (no authentication required)
		auth := api.Group("/auth")
		{
			auth.POST("/register", handlers.Register)
			auth.POST("/login", handlers.Login)
		}

		// Protected routes (authentication required)
		protected := api.Group("")
		protected.Use(middleware.AuthMiddleware())
		{
			// Auth
			protected.POST("/auth/logout", handlers.Logout)
			protected.GET("/auth/me", handlers.GetUserInfo)
			protected.DELETE("/auth/account", handlers.DeleteAccount)

			// Groups
			protected.POST("/groups/join", handlers.JoinGroup)
			protected.POST("/groups/leave", handlers.LeaveGroup)
			protected.GET("/groups/info", handlers.GetGroupInfo)

			// Categories
			protected.GET("/categories", handlers.GetCategories)
			protected.POST("/categories", handlers.CreateCategory)
			protected.PUT("/categories/:id", handlers.UpdateCategory)
			protected.DELETE("/categories/:id", handlers.DeleteCategory)

			// Items
			protected.GET("/items", handlers.GetItems)
			protected.GET("/items/expiring", handlers.GetExpiringItems)
			protected.POST("/items", handlers.CreateItem)
			protected.GET("/items/:id", handlers.GetItem)
			protected.PUT("/items/:id", handlers.UpdateItem)
			protected.DELETE("/items/:id", handlers.DeleteItem)

			// Recycle bin
			protected.GET("/recycle-bin", handlers.GetRecycleBin)
			protected.PUT("/recycle-bin/:id/restore", handlers.RestoreItem)
			protected.DELETE("/recycle-bin/:id", handlers.PermanentDeleteItem)
			protected.DELETE("/recycle-bin", handlers.EmptyRecycleBin)

			// Image upload
			protected.POST("/upload", handlers.UploadImage)

			// User settings
			protected.GET("/settings/expiring-days", handlers.GetExpiringDays)
			protected.PUT("/settings/expiring-days", handlers.UpdateExpiringDays)

			// Maintenance plans
			protected.GET("/maintenance/plans", handlers.GetPlans)
			protected.POST("/maintenance/plans", handlers.CreatePlan)
			protected.PUT("/maintenance/plans/:id", handlers.UpdatePlan)
			protected.DELETE("/maintenance/plans/:id", handlers.DeletePlan)

			// Maintenance items
			protected.GET("/maintenance/plans/:planId/items", handlers.GetMaintItems)
			protected.POST("/maintenance/plans/:planId/items", handlers.CreateMaintItem)
			protected.PUT("/maintenance/items/:id", handlers.UpdateMaintItem)
			protected.DELETE("/maintenance/items/:id", handlers.DeleteMaintItem)
			protected.POST("/maintenance/items/:id/done", handlers.MarkItemDone)

			// Maintenance due items
			protected.GET("/maintenance/due", handlers.GetDueItems)

			// Maintenance records
			protected.GET("/maintenance/records", handlers.GetAllRecords)
			protected.GET("/maintenance/plans/:planId/records", handlers.GetPlanRecords)
			protected.DELETE("/maintenance/records/:id", handlers.DeleteRecord)

			// Suggestions (意见箱)
			protected.POST("/suggestions", handlers.CreateSuggestion)
			protected.GET("/suggestions", handlers.GetSuggestions)
			protected.GET("/suggestions/all", handlers.GetAllSuggestions)
			protected.DELETE("/suggestions/:id", handlers.DeleteSuggestion)
			protected.GET("/suggestions/:id/download", handlers.DownloadSuggestionFile)
		}
	}

	// Start server
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	log.Printf("Server starting on port %s...", port)
	if err := r.Run(":" + port); err != nil {
		log.Fatalf("Failed to start server: %v", err)
	}
}
