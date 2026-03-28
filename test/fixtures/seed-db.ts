/**
 * Seeds the test fixture SQLite database with sample data.
 * Run: npx tsx test/fixtures/seed-db.ts
 */
import Database from "better-sqlite3";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const dbPath = resolve(__dirname, "test.db");

const db = new Database(dbPath);

// Enable WAL mode for better performance
db.pragma("journal_mode = WAL");

// Create tables
db.exec(`
  CREATE TABLE IF NOT EXISTS customers (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL,
    region TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    category TEXT NOT NULL,
    price REAL NOT NULL
  );

  CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY,
    customer INTEGER NOT NULL,
    amount REAL NOT NULL,
    region TEXT NOT NULL,
    status TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY (customer) REFERENCES customers(id)
  );
`);

// Clear existing data
db.exec("DELETE FROM orders; DELETE FROM customers; DELETE FROM products;");

// Seed customers
const insertCustomer = db.prepare(
  "INSERT INTO customers (id, name, email, region, created_at) VALUES (?, ?, ?, ?, ?)"
);
const customers = [
  [1, "Alice Johnson", "alice@example.com", "US", "2025-01-15"],
  [2, "Bob Smith", "bob@example.com", "EU", "2025-02-01"],
  [3, "Carol White", "carol@example.com", "US", "2025-03-10"],
  [4, "David Lee", "david@example.com", "APAC", "2025-04-20"],
  [5, "Eva Garcia", "eva@example.com", "EU", "2025-05-05"],
];
for (const c of customers) insertCustomer.run(...c);

// Seed products
const insertProduct = db.prepare(
  "INSERT INTO products (id, name, category, price) VALUES (?, ?, ?, ?)"
);
const products = [
  [1, "Widget Pro", "Hardware", 49.99],
  [2, "Gadget Plus", "Hardware", 129.99],
  [3, "DataSync", "Software", 19.99],
  [4, "CloudVault", "Software", 9.99],
  [5, "SensorKit", "Hardware", 299.99],
];
for (const p of products) insertProduct.run(...p);

// Seed orders
const insertOrder = db.prepare(
  "INSERT INTO orders (id, customer, amount, region, status, created_at) VALUES (?, ?, ?, ?, ?, ?)"
);
const statuses = ["completed", "pending", "shipped", "cancelled"];
const regions = ["US", "EU", "APAC"];
for (let i = 1; i <= 50; i++) {
  const customer = ((i - 1) % 5) + 1;
  const amount = Math.round((10 + Math.random() * 490) * 100) / 100;
  const region = regions[i % 3];
  const status = statuses[i % 4];
  const day = String((i % 28) + 1).padStart(2, "0");
  const month = String(((i - 1) % 12) + 1).padStart(2, "0");
  insertOrder.run(i, customer, amount, region, status, `2025-${month}-${day}`);
}

db.close();
console.log(`Seeded ${dbPath} with 5 customers, 5 products, 50 orders.`);
