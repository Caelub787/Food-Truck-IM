// Connection for the local test Postgres. Override with TEST_DATABASE_URL.
export const adminUrl = process.env.TEST_DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/postgres'
export const TEST_DB = 'truckstock_test'
export const testUrl = adminUrl.replace(/\/[^/]*$/, `/${TEST_DB}`)
