//go:build ignore
// +build ignore

package main

import (
	"context"
	"fmt"
	"os"

	"github.com/jackc/pgx/v5/pgxpool"
)

func main() {
	connStr := fmt.Sprintf("host=%s port=%s user=%s password=%s dbname=%s sslmode=disable",
		getEnv("DB_HOST", "localhost"),
		getEnv("DB_PORT", "5432"),
		getEnv("DB_USER", "postgres"),
		getEnv("DB_PASSWORD", "123"),
		getEnv("DB_NAME", "item_manager"),
	)

	pool, err := pgxpool.New(context.Background(), connStr)
	if err != nil {
		fmt.Println("Error:", err)
		os.Exit(1)
	}
	defer pool.Close()

	rows, err := pool.Query(context.Background(),
		`SELECT id, username, expiring_days FROM users ORDER BY created_at LIMIT 20`)
	if err != nil {
		fmt.Println("Query error:", err)
		os.Exit(1)
	}
	defer rows.Close()

	fmt.Println("ID | Username | ExpiringDays")
	fmt.Println("---|----------|-------------")
	for rows.Next() {
		var id string
		var username string
		var expiringDays *int
		if err := rows.Scan(&id, &username, &expiringDays); err != nil {
			fmt.Println("Scan error:", err)
			continue
		}
		if expiringDays == nil {
			fmt.Printf("%s | %s | NULL\n", id[:8], username)
		} else {
			fmt.Printf("%s | %s | %d\n", id[:8], username, *expiringDays)
		}
	}
}

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
