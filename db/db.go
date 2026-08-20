package db

import (
	"context"
	"fmt"
	"log"
	"os"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

var Pool *pgxpool.Pool

// Connect establishes connection to PostgreSQL
func Connect() error {
	dbHost := getEnv("DB_HOST", "localhost")
	dbPort := getEnv("DB_PORT", "5432")
	dbUser := getEnv("DB_USER", "postgres")
	dbPassword := getEnv("DB_PASSWORD", "123")
	dbName := getEnv("DB_NAME", "item_manager")

	connStr := fmt.Sprintf("host=%s port=%s user=%s password=%s dbname=%s sslmode=disable",
		dbHost, dbPort, dbUser, dbPassword, dbName)

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	config, err := pgxpool.ParseConfig(connStr)
	if err != nil {
		return fmt.Errorf("unable to parse config: %w", err)
	}
	config.MaxConns = 20

	Pool, err = pgxpool.NewWithConfig(ctx, config)
	if err != nil {
		return fmt.Errorf("unable to create connection pool: %w", err)
	}

	if err := Pool.Ping(ctx); err != nil {
		return fmt.Errorf("unable to ping database: %w", err)
	}

	log.Println("Connected to PostgreSQL successfully")
	return nil
}

// Migrate runs database migrations
func Migrate() error {
	ctx := context.Background()

	// Create users table
	_, err := Pool.Exec(ctx, `
		CREATE TABLE IF NOT EXISTS users (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			username VARCHAR(255) UNIQUE NOT NULL,
			password_hash VARCHAR(255) NOT NULL,
			is_group BOOLEAN DEFAULT FALSE,
			group_id UUID REFERENCES users(id) ON DELETE SET NULL,
			created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
			updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
		)
	`)
	if err != nil {
		return fmt.Errorf("failed to create users table: %w", err)
	}

	// Create categories table
	_, err = Pool.Exec(ctx, `
		CREATE TABLE IF NOT EXISTS categories (
			id SERIAL PRIMARY KEY,
			name VARCHAR(100) NOT NULL,
			user_id UUID REFERENCES users(id) ON DELETE CASCADE,
			is_default BOOLEAN DEFAULT FALSE,
			created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
			UNIQUE(name, user_id)
		)
	`)
	if err != nil {
		return fmt.Errorf("failed to create categories table: %w", err)
	}

	// Create items table
	_, err = Pool.Exec(ctx, `
		CREATE TABLE IF NOT EXISTS items (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			name VARCHAR(255) NOT NULL,
			category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
			manufacturer VARCHAR(255) DEFAULT '',
			usage_desc TEXT DEFAULT '',
			production_date DATE NOT NULL,
			expiry_date DATE NOT NULL,
			image_url TEXT DEFAULT '',
			owner_id UUID REFERENCES users(id) ON DELETE CASCADE NOT NULL,
			ownergroup_id UUID REFERENCES users(id) ON DELETE SET NULL,
			is_private BOOLEAN DEFAULT FALSE,
			created_by UUID REFERENCES users(id) ON DELETE CASCADE NOT NULL,
			created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
			updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
			UNIQUE(owner_id, name)
		)
	`)
	if err != nil {
		return fmt.Errorf("failed to create items table: %w", err)
	}

	// Create sessions table for token management
	_, err = Pool.Exec(ctx, `
		CREATE TABLE IF NOT EXISTS sessions (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			user_id UUID REFERENCES users(id) ON DELETE CASCADE NOT NULL,
			token VARCHAR(500) NOT NULL,
			expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
			created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
		)
	`)
	if err != nil {
		return fmt.Errorf("failed to create sessions table: %w", err)
	}

	// Migrate: add ownergroup_id column if not exists (upgrade from old schema without this column)
	Pool.Exec(ctx, `ALTER TABLE items ADD COLUMN IF NOT EXISTS ownergroup_id UUID REFERENCES users(id) ON DELETE SET NULL`)

	// Migrate: update existing data - set ownergroup_id based on is_private and owner
	// For shared items (is_private=false), set ownergroup_id = owner_id (old model: owner_id was group id)
	// For private items (is_private=true), set ownergroup_id = NULL
	Pool.Exec(ctx, `UPDATE items SET ownergroup_id = owner_id WHERE is_private = false AND ownergroup_id IS NULL`)
	Pool.Exec(ctx, `UPDATE items SET ownergroup_id = NULL WHERE is_private = true`)

	// Create indexes
	indexes := []string{
		"CREATE INDEX IF NOT EXISTS idx_users_group_id ON users(group_id)",
		"CREATE INDEX IF NOT EXISTS idx_categories_user_id ON categories(user_id)",
		"CREATE INDEX IF NOT EXISTS idx_items_owner_id ON items(owner_id)",
		"CREATE INDEX IF NOT EXISTS idx_items_ownergroup_id ON items(ownergroup_id)",
		"CREATE INDEX IF NOT EXISTS idx_items_created_by ON items(created_by)",
		"CREATE INDEX IF NOT EXISTS idx_items_category_id ON items(category_id)",
		"CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id)",
	}

	for _, idx := range indexes {
		if _, err := Pool.Exec(ctx, idx); err != nil {
			return fmt.Errorf("failed to create index: %w", err)
		}
	}

	log.Println("Database migrations completed successfully")
	return nil
}

// Close closes the database connection pool
func Close() {
	if Pool != nil {
		Pool.Close()
	}
}

func getEnv(key, defaultValue string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return defaultValue
}
