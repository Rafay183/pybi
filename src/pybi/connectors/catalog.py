"""The PyBI connector catalog. Every entry is a declarative spec run by a generic engine (see engines.py).

Adding a connector is usually 5-10 lines: pick an engine, describe parameters, auth, records path and pagination.
"""
from __future__ import annotations

from typing import Dict, List

from .base import Connector
from .base import Param as P

CATALOG: List[Connector] = []


def add(c: Connector) -> Connector:
    CATALOG.append(c)
    return c


# ------------------------------------------------------------------ reusable parameter sets
def token(label="API token", key="token", help=""):
    return P(key, label, "password", True, secret=True, help=help)


def adv_rest():
    return [P("_max_pages", "Max pages to fetch", "number", default=200, advanced=True),
            P("_records", "Records path (dot path in the JSON)", advanced=True, placeholder="auto-detect"),
            P("_query", "Extra query parameters (JSON)", "json", advanced=True, placeholder='{"status": "open"}')]


def sql_params(port, db_label="Database", user=True, extra=None):
    ps = [P("host", "Server / host", required=True, placeholder="localhost"), P("port", "Port", "number", default=port),
          P("database", db_label, required=True)]
    if user:
        ps += [P("user", "Username"), P("password", "Password", "password", secret=True)]
    ps += (extra or []) + [P("schema", "Schema", advanced=True),
                           P("query", "SQL query (optional — leave blank to pick tables)", "textarea", advanced=False, placeholder="SELECT * FROM sales WHERE year = 2025")]
    return ps


FILE_SRC = [P("file", "Upload a file", "file"), P("path", "…or a path on this computer", placeholder="C:/data/sales.csv"),
            P("url", "…or a web URL", placeholder="https://example.com/data.csv")]

# ================================================================== FILES
FILES = "File"
for cid, name, fmt, extra, install, desc in [
    ("csv", "Text / CSV", ".csv", [P("delimiter", "Delimiter (blank = auto)", advanced=True), P("skiprows", "Skip first rows", "number", advanced=True)], None, "Comma, semicolon, tab or pipe separated text files."),
    ("tsv", "Tab-separated (TSV)", ".tsv", [], None, "Tab-delimited text."),
    ("fwf", "Fixed-width text", ".fwf", [], None, "Column positions inferred automatically."),
    ("excel", "Excel workbook", None, [P("sheet", "Sheet name (blank = all sheets)", advanced=True), P("skiprows", "Skip first rows", "number", advanced=True)], None, ".xlsx / .xlsm — every sheet becomes a table."),
    ("excel97", "Excel 97-2003 (.xls)", ".xls", [P("sheet", "Sheet name (blank = all)", advanced=True)], "xlrd", "Legacy Excel files."),
    ("xlsb", "Excel binary (.xlsb)", ".xlsb", [P("sheet", "Sheet name (blank = all)", advanced=True)], "pyxlsb", "Large binary workbooks."),
    ("ods", "OpenDocument spreadsheet", ".ods", [], "odfpy", "LibreOffice / OpenOffice Calc."),
    ("json", "JSON", ".json", [], None, "Arrays of objects, nested objects (flattened) or JSON Lines."),
    ("jsonl", "JSON Lines / NDJSON", ".jsonl", [], None, "One JSON object per line (logs, exports)."),
    ("xml", "XML", ".xml", [P("xpath", "XPath to rows (optional)", advanced=True, placeholder="//record")], None, "Repeating XML elements become rows."),
    ("html", "HTML file", ".html", [], None, "Every <table> in a saved web page."),
    ("parquet", "Parquet", ".parquet", [], "pyarrow", "Columnar files from data lakes, Spark, pandas."),
    ("feather", "Feather / Arrow IPC", ".feather", [], "pyarrow", "Apache Arrow files."),
    ("orc", "ORC", ".orc", [], "pyarrow", "Hive / Hadoop ORC files."),
    ("avro", "Avro", ".avro", [], "fastavro", "Apache Avro container files."),
    ("sas", "SAS (.sas7bdat / .xpt)", None, [], None, "SAS datasets and transport files."),
    ("spss", "SPSS (.sav)", ".sav", [], "pyreadstat", "IBM SPSS Statistics data."),
    ("stata", "Stata (.dta)", ".dta", [], None, "Stata datasets."),
    ("hdf5", "HDF5", ".h5", [], "tables", "Every key in a pandas HDF store."),
    ("yaml", "YAML", ".yaml", [], None, "Lists of mappings in YAML."),
    ("pdf", "PDF tables", ".pdf", [], None, "Extracts every table from text-based PDFs (invoices, reports)."),
    ("zip", "ZIP archive", ".zip", [], None, "Reads every supported file inside an archive."),
]:
    add(Connector(cid, name, FILES, "file", FILE_SRC + extra, {"format": fmt} if fmt else {}, desc, install, multi=True))

add(Connector("sqlite", "SQLite database", "Database", "sql", [P("path", "Database file path", required=True, placeholder="C:/data/app.db"),
    P("query", "SQL query (optional)", "textarea")], {"kind": "sqlite"}, "Local .db / .sqlite files — no server needed.", None, multi=True))
add(Connector("folder", "Folder (combine files)", FILES, "folder", [P("path", "Folder path on this computer", required=True, placeholder="C:/reports/monthly"),
    P("pattern", "File pattern", default="*.csv", help="e.g. *.xlsx or sales_*.csv"), P("combine", "Append all files into one table (adds Source.Name)", "checkbox", default=True)],
    {}, "Like Power BI's Folder connector: every file in a folder (and sub-folders), appended."))

# ================================================================== WEB & SHARE LINKS
WEB = "Web & online files"
add(Connector("web", "Web page tables", WEB, "web", [P("url", "Page URL", required=True, placeholder="https://en.wikipedia.org/wiki/List_of_countries_by_GDP_(nominal)")],
              {"html": True}, "Scrapes every HTML table on a public web page.", multi=True))
add(Connector("wikipedia", "Wikipedia tables", WEB, "web", [P("url", "Wikipedia article URL", required=True, placeholder="https://en.wikipedia.org/wiki/…")],
              {"html": True}, "Any table from any Wikipedia article.", multi=True))
add(Connector("http_file", "File from URL", WEB, "file", [P("url", "File URL", required=True, placeholder="https://…/data.xlsx")], {}, "CSV, Excel, JSON, Parquet… from any direct link.", multi=True))
add(Connector("gsheets_public", "Google Sheets (shared link)", WEB, "file", [P("url", "Sheet link (Anyone with link can view)", required=True)],
              {"link": "gsheet", "ext": ".csv"}, "Paste a Google Sheets link — no login needed for shared sheets."))
add(Connector("gdrive_file", "Google Drive file", WEB, "file", [P("url", "Drive share link", required=True), P("format", "File type", "select", default=".csv", options=[".csv", ".xlsx", ".json", ".parquet"])],
              {"link": "gdrive"}, "Shared CSV/Excel/JSON files on Google Drive.", multi=True))
add(Connector("onedrive", "OneDrive / SharePoint file link", WEB, "file", [P("url", "Share link", required=True), P("format", "File type", "select", default=".xlsx", options=[".xlsx", ".csv", ".json"])],
              {"link": "onedrive"}, "Excel or CSV shared from OneDrive or SharePoint.", multi=True))
add(Connector("dropbox", "Dropbox file", WEB, "file", [P("url", "Dropbox share link", required=True)], {"link": "dropbox"}, "Shared Dropbox files.", multi=True))
add(Connector("github_file", "GitHub file", WEB, "file", [P("url", "GitHub file URL", required=True, placeholder="https://github.com/owner/repo/blob/main/data.csv")],
              {"link": "github"}, "Data files committed to a GitHub repository.", multi=True))
add(Connector("huggingface", "Hugging Face dataset file", WEB, "file", [P("repo", "Dataset repo", required=True, placeholder="owner/dataset"), P("filepath", "File path in the repo", "text", True, placeholder="data/train.csv")],
              {"url_template": "https://huggingface.co/datasets/{repo}/resolve/main/{filepath}"}, "CSV / Parquet / JSON files from Hugging Face datasets."))
add(Connector("owid", "Our World in Data", "Public data", "file", [P("slug", "Chart slug", required=True, default="life-expectancy", help="The last part of an ourworldindata.org/grapher/… URL"),
              ], {"ext": ".csv", "url_template": "https://ourworldindata.org/grapher/{slug}.csv?v=1&csvType=full&useColumnShortNames=false"}, "Thousands of global datasets: health, energy, economy, climate."))
add(Connector("rss", "RSS feed", WEB, "file", [P("url", "Feed URL", required=True), P("xpath", "Item XPath", default="//item", advanced=True)], {"format": ".xml"}, "News, blogs and podcast feeds as a table.", multi=False))

# ================================================================== DATABASES (SQLAlchemy)
DB = "Database"


def sqldb(cid, name, url, drivers, port, desc, install, db_label="Database", extra=None, user=True, kwargs=None, cat=DB):
    ps = sql_params(port, db_label, user, extra)
    add(Connector(cid, name, cat, "sql", ps + [P("url", "Full SQLAlchemy URL (overrides the fields above)", advanced=True)],
                  {"url": url, "drivers": drivers, "engine_kwargs": kwargs or {}}, desc, install, multi=True))


PG = ("postgresql+psycopg2://{user}:{password}@{host}:{port}/{database}", [("psycopg2", "psycopg2-binary")])
MY = ("mysql+pymysql://{user}:{password}@{host}:{port}/{database}", [("pymysql", "pymysql")])
for cid, name, desc in [("postgresql", "PostgreSQL", "The world's most advanced open-source database."),
                        ("timescaledb", "TimescaleDB", "Time-series on PostgreSQL."), ("greenplum", "Greenplum", "MPP analytics on PostgreSQL."),
                        ("yugabytedb", "YugabyteDB", "Distributed PostgreSQL (port 5433)."), ("supabase_db", "Supabase (Postgres)", "Direct Postgres connection to Supabase."),
                        ("neon", "Neon (serverless Postgres)", "Serverless Postgres."), ("cloudsql_pg", "Google Cloud SQL for PostgreSQL", "Managed Postgres on GCP."),
                        ("aurora_pg", "Amazon Aurora / RDS PostgreSQL", "Managed Postgres on AWS."), ("azure_pg", "Azure Database for PostgreSQL", "Managed Postgres on Azure."),
                        ("alloydb", "Google AlloyDB", "PostgreSQL-compatible AlloyDB.")]:
    sqldb(cid, name, PG[0], PG[1], 5433 if cid == "yugabytedb" else 5432, desc, "sqlalchemy psycopg2-binary")
for cid, name, desc in [("mysql", "MySQL", "Popular open-source relational database."), ("mariadb", "MariaDB", "MySQL-compatible community database."),
                        ("planetscale", "PlanetScale", "Serverless MySQL."), ("tidb", "TiDB", "Distributed MySQL-compatible SQL (port 4000)."),
                        ("cloudsql_mysql", "Google Cloud SQL for MySQL", "Managed MySQL on GCP."), ("aurora_mysql", "Amazon Aurora / RDS MySQL", "Managed MySQL on AWS."),
                        ("azure_mysql", "Azure Database for MySQL", "Managed MySQL on Azure.")]:
    sqldb(cid, name, MY[0], MY[1], 4000 if cid == "tidb" else 3306, desc, "sqlalchemy pymysql")
MSSQL = ("mssql+pymssql://{user}:{password}@{host}:{port}/{database}", [("pymssql", "pymssql")])
for cid, name, desc in [("sqlserver", "Microsoft SQL Server", "SQL Server 2012+ (SQL authentication)."), ("azuresql", "Azure SQL Database", "Azure SQL / Managed Instance."),
                        ("synapse", "Azure Synapse Analytics (SQL)", "Dedicated / serverless SQL pools."), ("fabric_wh", "Microsoft Fabric Warehouse (SQL endpoint)", "Fabric SQL analytics endpoint (SQL auth).")]:
    sqldb(cid, name, MSSQL[0], MSSQL[1], 1433, desc, "sqlalchemy pymssql")
sqldb("oracle", "Oracle Database", "oracle+oracledb://{user}:{password}@{host}:{port}/?service_name={database}", [("oracledb", "oracledb")], 1521, "Oracle 12c+ via the thin driver (no Oracle client needed).", "sqlalchemy oracledb", "Service name")
sqldb("db2", "IBM Db2", "db2+ibm_db://{user}:{password}@{host}:{port}/{database}", [("ibm_db_sa", "ibm_db_sa")], 50000, "IBM Db2 LUW / Db2 on Cloud.", "sqlalchemy ibm_db_sa")
sqldb("hana", "SAP HANA", "hana://{user}:{password}@{host}:{port}", [("sqlalchemy_hana", "sqlalchemy-hana")], 30015, "SAP HANA / HANA Cloud.", "sqlalchemy sqlalchemy-hana hdbcli", "Tenant database")
sqldb("teradata", "Teradata", "teradatasql://{user}:{password}@{host}/?database={database}", [("teradatasqlalchemy", "teradatasqlalchemy")], 1025, "Teradata Vantage.", "sqlalchemy teradatasqlalchemy")
sqldb("vertica", "Vertica", "vertica+vertica_python://{user}:{password}@{host}:{port}/{database}", [("vertica_python", "sqlalchemy-vertica-python")], 5433, "OpenText Vertica analytics.", "sqlalchemy sqlalchemy-vertica-python")
sqldb("cockroachdb", "CockroachDB", "cockroachdb://{user}:{password}@{host}:{port}/{database}?sslmode=require", [("sqlalchemy_cockroachdb", "sqlalchemy-cockroachdb"), ("psycopg2", "psycopg2-binary")], 26257, "Distributed SQL.", "sqlalchemy sqlalchemy-cockroachdb psycopg2-binary")
sqldb("singlestore", "SingleStore", "singlestoredb://{user}:{password}@{host}:{port}/{database}", [("sqlalchemy_singlestoredb", "sqlalchemy-singlestoredb")], 3306, "Real-time distributed SQL.", "sqlalchemy sqlalchemy-singlestoredb")
sqldb("exasol", "Exasol", "exa+websocket://{user}:{password}@{host}:{port}/{database}", [("sqlalchemy_exasol", "sqlalchemy-exasol")], 8563, "In-memory analytics database.", "sqlalchemy sqlalchemy-exasol", "Schema")
sqldb("firebird", "Firebird", "firebird+firebird://{user}:{password}@{host}:{port}/{database}", [("sqlalchemy_firebird", "sqlalchemy-firebird")], 3050, "Firebird RDBMS.", "sqlalchemy sqlalchemy-firebird", "Database path")
sqldb("clickhouse", "ClickHouse", "clickhousedb://{user}:{password}@{host}:{port}/{database}", [("clickhouse_connect", "clickhouse-connect")], 8123, "Blazing-fast columnar analytics (HTTP port).", "sqlalchemy clickhouse-connect")
sqldb("trino", "Trino", "trino://{user}@{host}:{port}/{database}", [("trino", "trino[sqlalchemy]")], 8080, "Distributed SQL query engine (catalog/schema).", "trino[sqlalchemy]", "Catalog/schema", user=True)
sqldb("presto", "Presto", "presto://{user}@{host}:{port}/{database}", [("pyhive", "pyhive[presto]")], 8080, "PrestoDB (catalog/schema).", "pyhive[presto]", "Catalog/schema")
sqldb("hive", "Apache Hive", "hive://{user}@{host}:{port}/{database}", [("pyhive", "pyhive[hive]")], 10000, "Hive via HiveServer2.", "pyhive[hive]")
sqldb("sparksql", "Spark SQL (Thrift server)", "hive://{user}@{host}:{port}/{database}", [("pyhive", "pyhive[hive]")], 10000, "Apache Spark Thrift JDBC/ODBC server.", "pyhive[hive]")
sqldb("impala", "Apache Impala", "impala://{host}:{port}/{database}", [("impala", "impyla")], 21050, "Cloudera Impala.", "impyla", user=False)
sqldb("druid", "Apache Druid", "druid://{host}:{port}/druid/v2/sql/", [("pydruid", "pydruid[sqlalchemy]")], 8082, "Real-time analytics (Druid SQL).", "pydruid[sqlalchemy]", "Datasource (unused)", user=False)
sqldb("pinot", "Apache Pinot", "pinot://{host}:{port}/query/sql?controller=http://{host}:9000/", [("pinotdb", "pinotdb")], 8099, "Real-time OLAP.", "pinotdb", "Table (unused)", user=False)
sqldb("dremio", "Dremio", "dremio+flight://{user}:{password}@{host}:{port}/dremio", [("sqlalchemy_dremio", "sqlalchemy-dremio")], 32010, "Data lakehouse via Arrow Flight.", "sqlalchemy-dremio", "Space")
sqldb("snowflake", "Snowflake", "snowflake://{user}:{password}@{host}/{database}/{schema}?warehouse={warehouse}&role={role}", [("snowflake.sqlalchemy", "snowflake-sqlalchemy")], 443,
      "Snowflake Data Cloud. Host = account identifier (e.g. xy12345.eu-west-1).", "snowflake-sqlalchemy", extra=[P("warehouse", "Warehouse"), P("role", "Role", advanced=True)])
sqldb("redshift", "Amazon Redshift", "redshift+redshift_connector://{user}:{password}@{host}:{port}/{database}", [("sqlalchemy_redshift", "sqlalchemy-redshift"), ("redshift_connector", "redshift_connector")], 5439, "AWS data warehouse.", "sqlalchemy-redshift redshift_connector")
add(Connector("bigquery", "Google BigQuery", DB, "sql", [P("project", "Project ID", required=True), P("dataset", "Dataset", required=True), P("credentials", "Service-account JSON key path", placeholder="C:/keys/sa.json"),
    P("query", "SQL query (optional)", "textarea"), P("url", "SQLAlchemy URL", advanced=True)],
    {"url": "bigquery://{project}/{dataset}", "drivers": [("sqlalchemy_bigquery", "sqlalchemy-bigquery")], "engine_kwargs": {"credentials_path": "{credentials}"}},
    "Google's serverless data warehouse.", "sqlalchemy-bigquery", multi=True))
add(Connector("athena", "Amazon Athena", DB, "sql", [P("region", "AWS region", required=True, default="us-east-1"), P("schema_name", "Database (schema)", required=True),
    P("s3_staging_dir", "S3 query results location", required=True, placeholder="s3://my-bucket/athena-results/"), P("access_key", "AWS access key ID"), P("secret_key", "AWS secret access key", "password", secret=True),
    P("query", "SQL query (optional)", "textarea"), P("url", "SQLAlchemy URL", advanced=True)],
    {"url": "awsathena+rest://{access_key}:{secret_key}@athena.{region}.amazonaws.com:443/{schema_name}?s3_staging_dir={s3_staging_dir}", "drivers": [("pyathena", "PyAthena[SQLAlchemy]")]},
    "Serverless SQL on S3 data.", "PyAthena[SQLAlchemy]", multi=True))
add(Connector("databricks", "Databricks SQL", DB, "sql", [P("host", "Server hostname", required=True, placeholder="adb-123.azuredatabricks.net"), P("http_path", "HTTP path", required=True),
    token("Personal access token"), P("catalog", "Catalog", default="main"), P("schema", "Schema", default="default"), P("query", "SQL query (optional)", "textarea"), P("url", "SQLAlchemy URL", advanced=True)],
    {"url": "databricks://token:{token}@{host}?http_path={http_path}&catalog={catalog}&schema={schema}", "drivers": [("databricks", "databricks-sqlalchemy")]},
    "Databricks SQL warehouses / Unity Catalog.", "databricks-sqlalchemy", multi=True))
add(Connector("duckdb", "DuckDB", DB, "sql", [P("path", "Database file (blank = in-memory)", placeholder="C:/data/warehouse.duckdb"),
    P("query", "SQL query (DuckDB can query CSV/Parquet files directly)", "textarea", placeholder="SELECT * FROM 'C:/data/*.parquet'")],
    {"kind": "duckdb", "database": "{path}"}, "Embedded analytics database — also queries Parquet/CSV globs.", "duckdb", multi=True))
add(Connector("motherduck", "MotherDuck", DB, "sql", [P("database", "Database", required=True), token("MotherDuck token"), P("query", "SQL query (optional)", "textarea")],
    {"kind": "duckdb", "database": "md:{database}?motherduck_token={token}"}, "Serverless DuckDB in the cloud.", "duckdb", multi=True))
add(Connector("access", "Microsoft Access", DB, "sql", [P("path", "Database file (.accdb / .mdb)", required=True), P("query", "SQL query (optional)", "textarea")],
    {"kind": "odbc", "conn": "DRIVER={{Microsoft Access Driver (*.mdb, *.accdb)}};DBQ={path};"}, "Access databases (Windows, needs the Access ODBC driver).", "pyodbc", multi=True))
add(Connector("odbc", "ODBC (any driver)", DB, "sql", [P("connection_string", "ODBC connection string", "password", True, secret=True, placeholder="DSN=MyDsn;UID=user;PWD=…"),
    P("schema", "Schema", advanced=True), P("query", "SQL query (optional)", "textarea")], {"kind": "odbc"}, "Any database with an ODBC driver (Sybase, Informix, Progress, Netezza…).", "pyodbc", multi=True))
add(Connector("sqlalchemy", "Other SQL database (SQLAlchemy URL)", DB, "sql", [P("url", "SQLAlchemy URL", "password", True, secret=True, placeholder="dialect+driver://user:pass@host/db"),
    P("schema", "Schema", advanced=True), P("query", "SQL query (optional)", "textarea")], {"url": "", "drivers": []}, "Any of the 40+ SQLAlchemy dialects.", "sqlalchemy + your driver", multi=True))

# ================================================================== NOSQL & SEARCH
NOSQL = "NoSQL & search"
add(Connector("mongodb", "MongoDB", NOSQL, "mongo", [P("uri", "Connection string", "password", True, secret=True, placeholder="mongodb://user:pass@localhost:27017"),
    P("database", "Database", required=True), P("collection", "Collection (blank = choose)"), P("filter", "Filter (JSON)", "json", advanced=True, placeholder='{"status": "active"}'),
    P("projection", "Projection (JSON)", "json", advanced=True), P("limit", "Max documents (0 = all)", "number", advanced=True)], {}, "MongoDB & MongoDB Atlas collections.", "pymongo", multi=True))
add(Connector("documentdb", "Amazon DocumentDB", NOSQL, "mongo", [P("uri", "Connection string", "password", True, secret=True), P("database", "Database", required=True), P("collection", "Collection")],
    {}, "MongoDB-compatible DocumentDB.", "pymongo", multi=True))
for cid, name in [("elasticsearch", "Elasticsearch"), ("opensearch", "OpenSearch")]:
    add(Connector(cid, name, NOSQL, "elastic", [P("url", "Cluster URL", required=True, placeholder="https://localhost:9200"), P("index", "Index (blank = choose)"),
        P("user", "Username"), P("password", "Password", "password", secret=True), P("api_key", "API key (instead of user/password)", "password", secret=True, advanced=True),
        P("query", "Query DSL (JSON)", "json", advanced=True, placeholder='{"range": {"@timestamp": {"gte": "now-7d"}}}'), P("size", "Max documents", "number", default=10000, advanced=True)],
        {}, f"Search indices in {name} (up to 10,000 hits).", None, multi=True))
add(Connector("solr", "Apache Solr", NOSQL, "rest", [P("url", "Solr URL", required=True, placeholder="http://localhost:8983/solr"), P("core", "Core / collection", required=True),
    P("q", "Query", default="*:*"), P("rows", "Rows", "number", default=10000)] + adv_rest(),
    {"base": "{url}", "endpoint": "/{core}/select", "query": {"q": "{q}", "rows": "{rows}", "wt": "json"}, "records": "response.docs"}, "Solr search results."))
add(Connector("couchdb", "Apache CouchDB", NOSQL, "rest", [P("url", "CouchDB URL", required=True, placeholder="http://localhost:5984"), P("database", "Database", required=True),
    P("user", "Username"), P("password", "Password", "password", secret=True)] + adv_rest(),
    {"base": "{url}", "endpoint": "/{database}/_all_docs", "query": {"include_docs": "true"}, "auth": {"type": "basic", "user": "{user}", "password": "{password}"}, "records": "rows", "post": "couch"},
    "All documents of a CouchDB database."))
add(Connector("influxdb", "InfluxDB 2.x / Cloud", NOSQL, "influx", [P("url", "URL", required=True, placeholder="http://localhost:8086"), P("org", "Organization", required=True), token(),
    P("bucket", "Bucket"), P("range", "Time range (Flux duration)", default="30d"), P("query", "Flux query (overrides bucket/range)", "textarea", advanced=True)], {}, "Time-series data via Flux."))
add(Connector("prometheus", "Prometheus", NOSQL, "rest", [P("url", "Prometheus URL", required=True, placeholder="http://localhost:9090"), P("query", "PromQL", required=True, default="up"),
    P("start", "Start (RFC3339 or unix)", required=True, placeholder="2025-01-01T00:00:00Z"), P("end", "End", required=True, placeholder="2025-01-02T00:00:00Z"), P("step", "Step", default="5m")] + adv_rest(),
    {"base": "{url}", "endpoint": "/api/v1/query_range", "query": {"query": "{query}", "start": "{start}", "end": "{end}", "step": "{step}"}, "records": "data.result", "post": "prometheus"},
    "Metrics as a time series table."))
add(Connector("redis", "Redis", NOSQL, "redis", [P("url", "Redis URL", "password", True, secret=True, default="redis://localhost:6379/0"), P("pattern", "Key pattern", default="*")],
    {}, "Keys, hashes, lists and sets (hashes become columns).", "redis"))
add(Connector("cassandra", "Apache Cassandra / ScyllaDB", NOSQL, "cassandra", [P("hosts", "Contact points", required=True, default="127.0.0.1"), P("port", "Port", "number", default=9042),
    P("keyspace", "Keyspace"), P("user", "Username"), P("password", "Password", "password", secret=True), P("table", "Table"), P("query", "CQL query (overrides table)", "textarea")],
    {}, "Wide-column databases via CQL.", "cassandra-driver"))
add(Connector("dynamodb", "Amazon DynamoDB", NOSQL, "dynamodb", [P("region", "Region", required=True, default="us-east-1"), P("table", "Table (blank = choose)"),
    P("access_key", "AWS access key ID (blank = default credentials)"), P("secret_key", "AWS secret access key", "password", secret=True), P("endpoint", "Endpoint URL (DynamoDB Local)", advanced=True)],
    {}, "Full table scans with pagination.", "boto3", multi=True))
add(Connector("firestore", "Google Firestore", NOSQL, "firestore", [P("collection", "Collection", required=True), P("credentials", "Service-account JSON path"), P("project", "Project ID", advanced=True)],
    {}, "Firestore documents.", "google-cloud-firestore"))
add(Connector("firebase_rtdb", "Firebase Realtime Database", NOSQL, "rest", [P("url", "Database URL", required=True, placeholder="https://my-app-default-rtdb.firebaseio.com"), P("node", "Path", required=True, placeholder="orders"),
    P("auth", "Database secret / ID token", "password", secret=True)] + adv_rest(),
    {"base": "{url}", "endpoint": "/{node}.json", "query": {"auth": "{auth}"}, "records": "", "post": "dict_values"}, "JSON tree nodes as rows."))
add(Connector("cosmosdb", "Azure Cosmos DB (NoSQL)", NOSQL, "cosmos", [P("url", "Account URI", required=True), P("key", "Primary key", "password", True, secret=True),
    P("database", "Database", required=True), P("container", "Container", required=True), P("query", "SQL query", "textarea", default="SELECT * FROM c")], {}, "Cosmos DB SQL API.", "azure-cosmos"))
add(Connector("neo4j", "Neo4j (Cypher)", NOSQL, "rest", [P("url", "HTTP URL", required=True, default="http://localhost:7474"), P("database", "Database", default="neo4j"),
    P("user", "Username", default="neo4j"), P("password", "Password", "password", secret=True), P("cypher", "Cypher query", "textarea", True, default="MATCH (n) RETURN n LIMIT 1000")],
    {"base": "{url}", "endpoint": "/db/{database}/tx/commit", "method": "POST", "body": {"statements": [{"statement": "{cypher}"}]},
     "auth": {"type": "basic", "user": "{user}", "password": "{password}"}, "records": "", "post": "neo4j"}, "Graph query results as a table via the HTTP API."))
add(Connector("supabase", "Supabase (REST API)", NOSQL, "rest", [P("project", "Project URL", required=True, placeholder="https://xyz.supabase.co"), P("table", "Table", required=True),
    token("Anon / service API key", "key"), P("select", "Columns (select)", default="*", advanced=True)] + adv_rest(),
    {"base": "{project}", "endpoint": "/rest/v1/{table}", "query": {"select": "{select}"}, "headers": {"apikey": "{key}"}, "auth": {"type": "bearer", "token": "{key}"},
     "records": "", "paginate": {"type": "offset", "param": "offset", "size_param": "limit", "size": 1000}}, "Supabase / PostgREST tables over HTTPS."))

# ================================================================== CLOUD STORAGE
CLOUD = "Cloud storage"
STORE_COMMON = [P("combine", "Append multiple matching files", "checkbox", default=True, advanced=True)]
add(Connector("s3", "Amazon S3", CLOUD, "storage", [P("path", "Bucket/key (wildcards allowed)", required=True, placeholder="my-bucket/exports/*.csv"),
    P("access_key", "Access key ID (blank = default credentials)"), P("secret_key", "Secret access key", "password", secret=True), P("region", "Region", advanced=True)] + STORE_COMMON,
    {"protocol": "s3", "drivers": [("s3fs", "s3fs")], "options": {"key": "{access_key}", "secret": "{secret_key}"}, "client_kwargs": {"region_name": "{region}"}},
    "Files in S3 buckets.", "fsspec s3fs", multi=True))
for cid, name, ep in [("minio", "MinIO", "http://localhost:9000"), ("r2", "Cloudflare R2", "https://<account>.r2.cloudflarestorage.com"),
                      ("wasabi", "Wasabi", "https://s3.wasabisys.com"), ("do_spaces", "DigitalOcean Spaces", "https://nyc3.digitaloceanspaces.com"),
                      ("backblaze", "Backblaze B2 (S3 API)", "https://s3.us-west-004.backblazeb2.com")]:
    add(Connector(cid, name, CLOUD, "storage", [P("endpoint", "Endpoint URL", required=True, default=ep), P("path", "Bucket/key (wildcards allowed)", required=True),
        P("access_key", "Access key", required=True), P("secret_key", "Secret key", "password", True, secret=True)] + STORE_COMMON,
        {"protocol": "s3", "drivers": [("s3fs", "s3fs")], "options": {"key": "{access_key}", "secret": "{secret_key}"}, "client_kwargs": {"endpoint_url": "{endpoint}"}},
        f"S3-compatible object storage ({name}).", "fsspec s3fs", multi=True))
add(Connector("gcs", "Google Cloud Storage", CLOUD, "storage", [P("path", "Bucket/object (wildcards allowed)", required=True), P("credentials", "Service-account JSON path (blank = default)")] + STORE_COMMON,
    {"protocol": "gcs", "drivers": [("gcsfs", "gcsfs")], "options": {"token": "{credentials}"}}, "Objects in GCS buckets.", "fsspec gcsfs", multi=True))
add(Connector("azure_blob", "Azure Blob Storage", CLOUD, "storage", [P("path", "Container/blob (wildcards allowed)", required=True), P("account_name", "Storage account", required=True),
    P("account_key", "Account key", "password", secret=True), P("sas_token", "SAS token (instead of key)", "password", secret=True, advanced=True)] + STORE_COMMON,
    {"protocol": "az", "drivers": [("adlfs", "adlfs")], "options": {"account_name": "{account_name}", "account_key": "{account_key}", "sas_token": "{sas_token}"}}, "Blobs in Azure Storage.", "fsspec adlfs", multi=True))
add(Connector("adls", "Azure Data Lake Storage Gen2", CLOUD, "storage", [P("path", "Filesystem/path (wildcards allowed)", required=True), P("account_name", "Storage account", required=True),
    P("account_key", "Account key", "password", secret=True)] + STORE_COMMON,
    {"protocol": "abfs", "drivers": [("adlfs", "adlfs")], "options": {"account_name": "{account_name}", "account_key": "{account_key}"}}, "ADLS Gen2 / OneLake-style paths.", "fsspec adlfs", multi=True))
add(Connector("sftp", "SFTP", CLOUD, "storage", [P("host", "Host", required=True), P("port", "Port", "number", default=22), P("username", "Username", required=True),
    P("password", "Password", "password", secret=True), P("path", "Remote file path (wildcards allowed)", required=True)] + STORE_COMMON,
    {"protocol": "sftp", "drivers": [("paramiko", "paramiko")], "options": {"host": "{host}", "port": "{port}", "username": "{username}", "password": "{password}"}}, "Files over SSH.", "fsspec paramiko", multi=True))
add(Connector("ftp", "FTP / FTPS", CLOUD, "storage", [P("host", "Host", required=True), P("user", "Username"), P("password", "Password", "password", secret=True),
    P("path", "File path", required=True), P("tls", "Use FTPS (TLS)", "checkbox")], {"protocol": "ftp"}, "Files on FTP servers (no extra packages).", None, multi=True))
add(Connector("webdav", "WebDAV / Nextcloud", CLOUD, "storage", [P("base_url", "WebDAV URL", required=True, placeholder="https://cloud.example.com/remote.php/dav/files/me"),
    P("user", "Username"), P("password", "Password / app password", "password", secret=True), P("path", "File path", required=True)] + STORE_COMMON,
    {"protocol": "webdav", "drivers": [("webdav4", "webdav4")], "options": {"base_url": "{base_url}", "auth": ["{user}", "{password}"]}}, "Nextcloud, ownCloud, any WebDAV server.", "fsspec webdav4", multi=True))
add(Connector("hdfs", "Hadoop HDFS", CLOUD, "storage", [P("host", "NameNode host", required=True), P("port", "Port", "number", default=8020), P("path", "File path (wildcards allowed)", required=True)] + STORE_COMMON,
    {"protocol": "hdfs", "drivers": [("pyarrow", "pyarrow")], "options": {"host": "{host}", "port": "{port}"}}, "Files on HDFS.", "fsspec pyarrow", multi=True))

# ================================================================== GENERIC PROTOCOLS
GEN = "Generic & developer"
add(Connector("rest_api", "REST API (any JSON / CSV API)", GEN, "rest", [P("url", "Endpoint URL", required=True, placeholder="https://api.example.com/v1/orders"),
    P("method", "Method", "select", default="GET", options=["GET", "POST"]), P("auth_type", "Authentication", "select", default="none", options=["none", "bearer", "basic", "header", "query"]),
    P("token", "Token / password / key value", "password", secret=True), P("user", "Username (basic) or header/param name"),
    P("pagination", "Pagination", "select", default="none", options=["none", "link", "page", "offset", "next_url", "cursor"]),
    P("page_param", "Page / offset / cursor parameter", default="page", advanced=True), P("size_param", "Page size parameter", default="per_page", advanced=True),
    P("next_path", "Next URL / cursor path in response", default="next", advanced=True), P("_body", "Request body (JSON)", "json", advanced=True),
    P("_headers", "Extra headers (JSON)", "json", advanced=True)] + adv_rest(),
    {"generic": True}, "Point PyBI at any HTTP API: auth, pagination and nested JSON handled for you."))
add(Connector("graphql", "GraphQL API", GEN, "graphql", [P("url", "GraphQL endpoint", required=True), P("token", "Bearer token", "password", secret=True),
    P("query", "Query", "textarea", True, default="query { items { id name } }"), P("variables", "Variables (JSON)", "json"), P("_records", "Records path", placeholder="data.items")],
    {"base": "{url}", "auth": {"type": "bearer", "token": "{token}"}}, "Any GraphQL endpoint."))
add(Connector("odata", "OData feed", GEN, "rest", [P("url", "OData URL", required=True, placeholder="https://services.odata.org/V4/Northwind/Northwind.svc/Orders"),
    P("token", "Bearer token (optional)", "password", secret=True), P("user", "Username (basic auth)", advanced=True), P("password", "Password", "password", secret=True, advanced=True)] + adv_rest(),
    {"base": "{url}", "auth": {"type": "bearer", "token": "{token}"}, "records": "value", "paginate": {"type": "next_url", "path": "@odata.nextLink"}},
    "OData v2/v4 feeds (SAP, Dynamics, SharePoint, Business Central…)."))
add(Connector("python", "Python script", GEN, "python", [P("script", "Python code — every pandas DataFrame variable becomes a table", "textarea", True,
    default="import pandas as pd\n\ndf = pd.DataFrame({'Month': ['Jan', 'Feb', 'Mar'], 'Sales': [120, 150, 170]})\n")],
    {}, "Run Python (pandas, numpy, any installed library) to produce tables.", None, multi=False))

# ================================================================== SAAS & BUSINESS APPS


def saas(cid, name, cat, params, cfg, desc, install=None, docs=""):
    add(Connector(cid, name, cat, "rest", params + adv_rest(), cfg, desc, install, docs=docs))


def res(options):
    return P("resource", "Data to load", "select", True, default=list(options)[0], options=list(options))


DEV = "Developer tools"
CRM = "CRM & sales"
FIN = "Finance & payments"
MKT = "Marketing & analytics"
SUP = "Support & ITSM"
PM = "Project & productivity"
HR = "HR & time tracking"
ECOM = "E-commerce & CMS"
MS = "Microsoft & Google"

GH_RES = {"Issues": {"endpoint": "/repos/{owner}/{repo}/issues", "query": {"state": "all"}}, "Pull requests": {"endpoint": "/repos/{owner}/{repo}/pulls", "query": {"state": "all"}},
          "Commits": {"endpoint": "/repos/{owner}/{repo}/commits"}, "Releases": {"endpoint": "/repos/{owner}/{repo}/releases"},
          "Contributors": {"endpoint": "/repos/{owner}/{repo}/contributors"}, "Workflow runs": {"endpoint": "/repos/{owner}/{repo}/actions/runs", "records": "workflow_runs"},
          "Organization repos": {"endpoint": "/orgs/{owner}/repos"}, "User repos": {"endpoint": "/users/{owner}/repos"}}
saas("github", "GitHub", DEV, [res(GH_RES), P("owner", "Owner / org", required=True), P("repo", "Repository"), P("token", "Personal access token (optional, raises limits)", "password", secret=True)],
     {"base": "https://api.github.com", "resources": GH_RES, "query": {"per_page": "100"}, "headers": {"X-GitHub-Api-Version": "2022-11-28"},
      "auth": {"type": "bearer", "token": "{token}"}, "paginate": {"type": "link"}}, "Issues, PRs, commits, releases, Actions runs.")
GL_RES = {"Issues": {"endpoint": "/projects/{project}/issues"}, "Merge requests": {"endpoint": "/projects/{project}/merge_requests"},
          "Pipelines": {"endpoint": "/projects/{project}/pipelines"}, "Commits": {"endpoint": "/projects/{project}/repository/commits"}}
saas("gitlab", "GitLab", DEV, [res(GL_RES), P("host", "GitLab host", default="https://gitlab.com"), P("project", "Project ID or path (group/project)", required=True), token("Access token")],
     {"base": "{host}/api/v4", "resources": GL_RES, "query": {"per_page": "100"}, "headers": {"PRIVATE-TOKEN": "{token}"}, "paginate": {"type": "link"}}, "Issues, MRs, pipelines.")
BB_RES = {"Repositories": {"endpoint": "/repositories/{workspace}"}, "Pull requests": {"endpoint": "/repositories/{workspace}/{repo}/pullrequests", "query": {"state": "ALL"}}}
saas("bitbucket", "Bitbucket Cloud", DEV, [res(BB_RES), P("workspace", "Workspace", required=True), P("repo", "Repository"), P("user", "Username", required=True), token("App password", "password")],
     {"base": "https://api.bitbucket.org/2.0", "resources": BB_RES, "auth": {"type": "basic", "user": "{user}", "password": "{password}"}, "records": "values", "paginate": {"type": "next_url", "path": "next"}}, "Repos and pull requests.")
saas("azure_devops", "Azure DevOps", DEV, [res({"Builds": 0, "Pull requests": 0, "Releases": 0}), P("org", "Organization", required=True), P("project", "Project", required=True), token("Personal access token", "pat")],
     {"base": "https://dev.azure.com/{org}/{project}/_apis", "resources": {"Builds": {"endpoint": "/build/builds"}, "Pull requests": {"endpoint": "/git/pullrequests", "query": {"searchCriteria.status": "all"}},
      "Releases": {"base": "https://vsrm.dev.azure.com/{org}/{project}/_apis", "endpoint": "/release/releases"}}, "query": {"api-version": "7.1"},
      "auth": {"type": "basic", "user": "", "password": "{pat}"}, "records": "value"}, "Builds, PRs, releases.")
JIRA = {"base": "https://{site}", "auth": {"type": "basic", "user": "{email}", "password": "{token}"}}
saas("jira", "Jira Cloud", PM, [P("site", "Site", required=True, placeholder="yourcompany.atlassian.net"), P("email", "Account email", required=True), token(),
     P("jql", "JQL", default="project IS NOT EMPTY ORDER BY created DESC"), P("fields", "Fields", default="*navigable", advanced=True)],
     dict(JIRA, endpoint="/rest/api/3/search/jql", query={"jql": "{jql}", "fields": "{fields}", "maxResults": "100"}, records="issues",
          paginate={"type": "cursor", "param": "nextPageToken", "path": "nextPageToken"}), "Issues by JQL (fields flattened).")
saas("confluence", "Confluence Cloud", PM, [P("site", "Site", required=True, placeholder="yourcompany.atlassian.net"), P("email", "Account email", required=True), token()],
     dict(JIRA, endpoint="/wiki/api/v2/pages", query={"limit": "100"}, records="results", paginate={"type": "next_url", "path": "_links.next", "origin": "https://{site}"}), "Pages and metadata.")
saas("trello", "Trello", PM, [res({"Cards": 0, "Lists": 0, "Actions": 0}), P("board", "Board ID", required=True), P("key", "API key", required=True), token()],
     {"base": "https://api.trello.com/1", "resources": {"Cards": {"endpoint": "/boards/{board}/cards"}, "Lists": {"endpoint": "/boards/{board}/lists"}, "Actions": {"endpoint": "/boards/{board}/actions", "query": {"limit": "1000"}}},
      "query": {"key": "{key}", "token": "{token}"}, "records": ""}, "Cards, lists and activity of a board.")
saas("asana", "Asana", PM, [P("project", "Project GID", required=True), token("Personal access token")],
     {"base": "https://app.asana.com/api/1.0", "endpoint": "/tasks", "query": {"project": "{project}", "limit": "100",
      "opt_fields": "name,completed,completed_at,created_at,due_on,assignee.name,memberships.section.name,tags.name"},
      "auth": {"type": "bearer", "token": "{token}"}, "records": "data", "paginate": {"type": "cursor", "param": "offset", "path": "next_page.offset"}}, "Tasks of a project.")
saas("clickup", "ClickUp", PM, [P("list_id", "List ID", required=True), token()],
     {"base": "https://api.clickup.com/api/v2", "endpoint": "/list/{list_id}/task", "query": {"include_closed": "true", "subtasks": "true"}, "headers": {"Authorization": "{token}"},
      "records": "tasks", "paginate": {"type": "page", "param": "page", "start": 0, "more": "last_page", "stop_short": False}}, "Tasks of a list.")
add(Connector("monday", "monday.com", PM, "graphql", [P("board", "Board ID", required=True), token(),
    P("query", "GraphQL query", "textarea", advanced=True, default="query ($board: [ID!]) { boards(ids: $board) { items_page(limit: 500) { items { id name group { title } created_at updated_at column_values { column { title } text } } } } }")] + adv_rest(),
    {"base": "https://api.monday.com/v2", "headers": {"Authorization": "{token}", "API-Version": "2024-10"}, "variables": {"board": ["{board}"]},
     "records": "data.boards.0.items_page.items"}, "Board items with column values."))
saas("notion", "Notion database", PM, [P("database", "Database ID", required=True), token("Integration secret")],
     {"base": "https://api.notion.com/v1", "endpoint": "/databases/{database}/query", "method": "POST", "body": {"page_size": 100}, "headers": {"Notion-Version": "2022-06-28"},
      "auth": {"type": "bearer", "token": "{token}"}, "records": "results", "post": "notion", "paginate": {"type": "cursor", "param": "start_cursor", "path": "next_cursor", "more": "has_more", "in": "body"}},
     "Rows of a Notion database with readable property values.")
saas("airtable", "Airtable", PM, [P("base_id", "Base ID", required=True, placeholder="appXXXXXXXX"), P("table", "Table name or ID", required=True), token("Personal access token"),
     P("view", "View", advanced=True)],
     {"base": "https://api.airtable.com/v0", "endpoint": "/{base_id}/{table}", "query": {"view": "{view}", "pageSize": "100"}, "auth": {"type": "bearer", "token": "{token}"},
      "records": "records", "post": "fields", "paginate": {"type": "cursor", "param": "offset", "path": "offset"}}, "Records of an Airtable table.")
saas("smartsheet", "Smartsheet", PM, [P("sheet", "Sheet ID", required=True), token()],
     {"base": "https://api.smartsheet.com/2.0", "endpoint": "/sheets/{sheet}", "auth": {"type": "bearer", "token": "{token}"}, "records": "rows", "post": "smartsheet"}, "A sheet as a table.")
saas("coda", "Coda", PM, [P("doc", "Doc ID", required=True), P("table", "Table ID or name", required=True), token()],
     {"base": "https://coda.io/apis/v1", "endpoint": "/docs/{doc}/tables/{table}/rows", "query": {"useColumnNames": "true", "valueFormat": "simple"}, "auth": {"type": "bearer", "token": "{token}"},
      "records": "items", "post": "coda", "paginate": {"type": "cursor", "param": "pageToken", "path": "nextPageToken"}}, "Coda tables.")
saas("baserow", "Baserow", PM, [P("host", "Host", default="https://api.baserow.io"), P("table", "Table ID", required=True), token("Database token")],
     {"base": "{host}/api", "endpoint": "/database/rows/table/{table}/", "query": {"user_field_names": "true", "size": "200"}, "headers": {"Authorization": "Token {token}"},
      "records": "results", "paginate": {"type": "next_url", "path": "next"}}, "Open-source Airtable alternative.")
add(Connector("linear", "Linear", DEV, "graphql", [token("API key"), P("query", "GraphQL query", "textarea", advanced=True,
    default="query ($after: String) { issues(first: 100, after: $after) { nodes { id identifier title priority estimate createdAt completedAt state { name } assignee { name } team { name } } pageInfo { hasNextPage endCursor } } }")] + adv_rest(),
    {"base": "https://api.linear.app/graphql", "headers": {"Authorization": "{token}"}, "records": "data.issues.nodes",
     "paginate": {"type": "graphql", "has_next": "data.issues.pageInfo.hasNextPage", "cursor": "data.issues.pageInfo.endCursor", "var": "after"}}, "Issues across teams."))
saas("sentry", "Sentry", DEV, [P("org", "Organization slug", required=True), P("project", "Project slug", required=True), token("Auth token"), P("host", "Host", default="https://sentry.io", advanced=True)],
     {"base": "{host}/api/0", "endpoint": "/projects/{org}/{project}/issues/", "auth": {"type": "bearer", "token": "{token}"}, "records": "", "paginate": {"type": "link", "results_flag": True}}, "Error issues.")
saas("pagerduty", "PagerDuty", SUP, [res({"Incidents": 0, "Services": 0}), token("API key")],
     {"base": "https://api.pagerduty.com", "resources": {"Incidents": {"endpoint": "/incidents", "records": "incidents"}, "Services": {"endpoint": "/services", "records": "services"}},
      "headers": {"Authorization": "Token token={token}"}, "paginate": {"type": "offset", "param": "offset", "size_param": "limit", "size": 100, "more": "more"}}, "Incidents and services.")
saas("datadog", "Datadog metrics", DEV, [P("query", "Metric query", required=True, default="avg:system.cpu.user{*}"), P("from", "From (unix seconds)", required=True), P("to", "To (unix seconds)", required=True),
     P("api_key", "API key", "password", True, secret=True), P("app_key", "Application key", "password", True, secret=True), P("site", "Site", default="datadoghq.com", advanced=True)],
     {"base": "https://api.{site}", "endpoint": "/api/v1/query", "query": {"query": "{query}", "from": "{from}", "to": "{to}"}, "headers": {"DD-API-KEY": "{api_key}", "DD-APPLICATION-KEY": "{app_key}"},
      "records": "series", "post": "datadog"}, "Timeseries points for a metric query.")
saas("grafana", "Grafana (dashboards list)", DEV, [P("url", "Grafana URL", required=True), token("Service account token")],
     {"base": "{url}", "endpoint": "/api/search", "auth": {"type": "bearer", "token": "{token}"}, "records": ""}, "Dashboards and folders inventory.")

# ---- CRM & sales
saas("salesforce", "Salesforce (SOQL)", CRM, [P("instance", "Instance URL", required=True, placeholder="https://yourorg.my.salesforce.com"), token("Access token"),
     P("soql", "SOQL query", "textarea", True, default="SELECT Id, Name, StageName, Amount, CloseDate FROM Opportunity"), P("version", "API version", default="v61.0", advanced=True)],
     {"base": "{instance}", "endpoint": "/services/data/{version}/query", "query": {"q": "{soql}"}, "auth": {"type": "bearer", "token": "{token}"}, "records": "records", "post": "salesforce",
      "paginate": {"type": "next_url", "path": "nextRecordsUrl", "origin": "{instance}"}}, "Any object via SOQL (bring an OAuth access token).")
HS = {"Contacts": "contacts", "Companies": "companies", "Deals": "deals", "Tickets": "tickets", "Products": "products", "Line items": "line_items"}
saas("hubspot", "HubSpot", CRM, [res(HS), token("Private app token"), P("properties", "Properties (comma-separated)", advanced=True, placeholder="firstname,lastname,email")],
     {"base": "https://api.hubapi.com/crm/v3/objects", "resources": {k: {"endpoint": "/" + v} for k, v in HS.items()}, "query": {"limit": "100", "properties": "{properties}"},
      "auth": {"type": "bearer", "token": "{token}"}, "records": "results", "post": "properties", "paginate": {"type": "cursor", "param": "after", "path": "paging.next.after"}}, "CRM objects with properties as columns.")
PD = {"Deals": "deals", "Persons": "persons", "Organizations": "organizations", "Activities": "activities", "Products": "products"}
saas("pipedrive", "Pipedrive", CRM, [res(PD), P("company", "Company domain", required=True, placeholder="yourcompany"), token("API token")],
     {"base": "https://{company}.pipedrive.com/api/v1", "resources": {k: {"endpoint": "/" + v} for k, v in PD.items()}, "query": {"limit": "500"},
      "auth": {"type": "query", "name": "api_token", "value": "{token}"}, "records": "data",
      "paginate": {"type": "offset", "param": "start", "next": "additional_data.pagination.next_start", "more": "additional_data.pagination.more_items_in_collection"}}, "Deals, people, organizations, activities.")
saas("zoho_crm", "Zoho CRM", CRM, [P("module", "Module", default="Leads", required=True), token("OAuth access token"), P("fields", "Fields", default="Last_Name,Email,Company,Lead_Status,Created_Time"),
     P("domain", "Data centre domain", default="www.zohoapis.com", advanced=True)],
     {"base": "https://{domain}/crm/v6", "endpoint": "/{module}", "query": {"fields": "{fields}", "per_page": "200"}, "headers": {"Authorization": "Zoho-oauthtoken {token}"},
      "records": "data", "paginate": {"type": "page", "param": "page", "more": "info.more_records", "stop_short": False}}, "Leads, contacts, deals…")
saas("freshsales", "Freshsales", CRM, [P("domain", "Bundle alias", required=True, placeholder="yourcompany.myfreshworks.com"), P("view", "View ID", required=True), token("API key")],
     {"base": "https://{domain}/crm/sales/api", "endpoint": "/contacts/view/{view}", "headers": {"Authorization": "Token token={token}"}, "records": "contacts",
      "paginate": {"type": "page", "param": "page", "total_pages": "meta.total_pages"}}, "Contacts from a saved view.")
saas("close", "Close CRM", CRM, [res({"Leads": "lead", "Opportunities": "opportunity"}), token("API key")],
     {"base": "https://api.close.com/api/v1", "resources": {"Leads": {"endpoint": "/lead/"}, "Opportunities": {"endpoint": "/opportunity/"}},
      "auth": {"type": "basic", "user": "{token}", "password": ""}, "records": "data", "paginate": {"type": "offset", "param": "_skip", "size_param": "_limit", "size": 100, "more": "has_more"}}, "Leads and opportunities.")
saas("copper", "Copper CRM", CRM, [P("email", "User email", required=True), token("API key")],
     {"base": "https://api.copper.com/developer_api/v1", "endpoint": "/opportunities/search", "method": "POST", "body": {"page_size": 200},
      "headers": {"X-PW-AccessToken": "{token}", "X-PW-Application": "developer_api", "X-PW-UserEmail": "{email}"}, "records": "",
      "paginate": {"type": "offset", "param": "page_number", "in": "body", "step_pages": True, "start_offset": 1, "size": 200}}, "Opportunities.")
saas("dynamics365", "Dynamics 365 / Dataverse", CRM, [P("org", "Environment URL", required=True, placeholder="https://yourorg.crm.dynamics.com"), P("entity", "Entity set", required=True, default="accounts"),
     token("OAuth access token"), P("select", "$select columns", advanced=True)],
     {"base": "{org}/api/data/v9.2", "endpoint": "/{entity}", "query": {"$select": "{select}"}, "auth": {"type": "bearer", "token": "{token}"}, "records": "value",
      "headers": {"Prefer": "odata.maxpagesize=5000"}, "paginate": {"type": "next_url", "path": "@odata.nextLink"}}, "Any Dataverse table.")
saas("activecampaign", "ActiveCampaign", CRM, [res({"Contacts": 0, "Deals": 0}), P("account", "Account URL", required=True, placeholder="https://youraccount.api-us1.com"), token("API key")],
     {"base": "{account}/api/3", "resources": {"Contacts": {"endpoint": "/contacts", "records": "contacts"}, "Deals": {"endpoint": "/deals", "records": "deals"}},
      "headers": {"Api-Token": "{token}"}, "paginate": {"type": "offset", "param": "offset", "size_param": "limit", "size": 100, "total": "meta.total"}}, "Contacts and deals.")

# ---- finance & payments
ST = {"Charges": "charges", "Customers": "customers", "Invoices": "invoices", "Subscriptions": "subscriptions", "Payment intents": "payment_intents",
      "Balance transactions": "balance_transactions", "Products": "products", "Prices": "prices", "Refunds": "refunds", "Payouts": "payouts"}
saas("stripe", "Stripe", FIN, [res(ST), token("Secret / restricted key")],
     {"base": "https://api.stripe.com/v1", "resources": {k: {"endpoint": "/" + v} for k, v in ST.items()}, "query": {"limit": "100"}, "auth": {"type": "bearer", "token": "{token}"},
      "records": "data", "paginate": {"type": "last_id", "param": "starting_after", "more": "has_more"}}, "Payments, customers, invoices, subscriptions.")
saas("paypal", "PayPal transactions", FIN, [P("start", "Start date (ISO)", required=True, placeholder="2025-01-01T00:00:00-0000"), P("end", "End date (ISO, max 31 days)", required=True), token("OAuth access token"),
     P("host", "API host", default="https://api-m.paypal.com", advanced=True)],
     {"base": "{host}", "endpoint": "/v1/reporting/transactions", "query": {"start_date": "{start}", "end_date": "{end}", "fields": "all", "page_size": "500"},
      "auth": {"type": "bearer", "token": "{token}"}, "records": "transaction_details", "paginate": {"type": "page", "param": "page", "total_pages": "total_pages"}}, "Transaction search.")
saas("square", "Square", FIN, [res({"Payments": 0, "Customers": 0, "Orders (locations)": 0}), token("Access token")],
     {"base": "https://connect.squareup.com/v2", "resources": {"Payments": {"endpoint": "/payments", "records": "payments"}, "Customers": {"endpoint": "/customers", "records": "customers"},
      "Orders (locations)": {"endpoint": "/locations", "records": "locations"}}, "headers": {"Square-Version": "2024-10-17"}, "auth": {"type": "bearer", "token": "{token}"},
      "paginate": {"type": "cursor", "param": "cursor", "path": "cursor"}}, "Payments and customers.")
saas("xero", "Xero", FIN, [res({"Invoices": 0, "Contacts": 0, "Payments": 0, "Bank transactions": 0}), token("OAuth access token"), P("tenant", "Tenant ID", required=True)],
     {"base": "https://api.xero.com/api.xro/2.0", "resources": {"Invoices": {"endpoint": "/Invoices", "records": "Invoices"}, "Contacts": {"endpoint": "/Contacts", "records": "Contacts"},
      "Payments": {"endpoint": "/Payments", "records": "Payments"}, "Bank transactions": {"endpoint": "/BankTransactions", "records": "BankTransactions"}},
      "headers": {"xero-tenant-id": "{tenant}"}, "auth": {"type": "bearer", "token": "{token}"}, "paginate": {"type": "page", "param": "page", "stop_short": False}}, "Accounting data.")
saas("quickbooks", "QuickBooks Online", FIN, [P("realm", "Company (realm) ID", required=True), P("entity", "Entity", "select", default="Invoice", options=["Invoice", "Customer", "Bill", "Payment", "Item", "Vendor", "Account", "Purchase"]),
     token("OAuth access token"), P("host", "Host", default="https://quickbooks.api.intuit.com", advanced=True)],
     {"base": "{host}", "endpoint": "/v3/company/{realm}/query", "query": {"query": "select * from {entity} maxresults 1000", "minorversion": "73"}, "auth": {"type": "bearer", "token": "{token}"},
      "records": "QueryResponse.{entity}"}, "Accounting entities via the query API.")
saas("chargebee", "Chargebee", FIN, [res({"Subscriptions": "subscriptions", "Customers": "customers", "Invoices": "invoices"}), P("site", "Site", required=True), token("API key")],
     {"base": "https://{site}.chargebee.com/api/v2", "resources": {"Subscriptions": {"endpoint": "/subscriptions"}, "Customers": {"endpoint": "/customers"}, "Invoices": {"endpoint": "/invoices"}},
      "query": {"limit": "100"}, "auth": {"type": "basic", "user": "{token}", "password": ""}, "records": "list", "post": "unwrap",
      "paginate": {"type": "cursor", "param": "offset", "path": "next_offset"}}, "Subscription billing.")
saas("paddle", "Paddle Billing", FIN, [res({"Transactions": 0, "Subscriptions": 0, "Customers": 0}), token("API key")],
     {"base": "https://api.paddle.com", "resources": {"Transactions": {"endpoint": "/transactions"}, "Subscriptions": {"endpoint": "/subscriptions"}, "Customers": {"endpoint": "/customers"}},
      "auth": {"type": "bearer", "token": "{token}"}, "records": "data", "paginate": {"type": "next_url", "path": "meta.pagination.next"}}, "Paddle billing objects.")
saas("lemonsqueezy", "Lemon Squeezy", FIN, [res({"Orders": 0, "Subscriptions": 0}), token("API key")],
     {"base": "https://api.lemonsqueezy.com/v1", "resources": {"Orders": {"endpoint": "/orders"}, "Subscriptions": {"endpoint": "/subscriptions"}},
      "headers": {"Accept": "application/vnd.api+json"}, "auth": {"type": "bearer", "token": "{token}"}, "records": "data", "post": "attributes", "paginate": {"type": "next_url", "path": "links.next"}}, "Orders & subscriptions.")

# ---- marketing & analytics
saas("ga4", "Google Analytics 4", MKT, [P("property", "Property ID", required=True), token("OAuth access token"), P("start", "Start date", default="30daysAgo"), P("end", "End date", default="today"),
     P("dimensions", "Dimensions", default="date,sessionDefaultChannelGroup"), P("metrics", "Metrics", default="sessions,totalUsers,conversions")],
     {"base": "https://analyticsdata.googleapis.com/v1beta", "endpoint": "/properties/{property}:runReport", "method": "POST",
      "body_fn": "ga4", "auth": {"type": "bearer", "token": "{token}"}, "records": "rows", "post": "ga4"}, "Report rows (dimensions + metrics).")
saas("youtube", "YouTube channel videos", MKT, [P("playlist", "Uploads playlist ID", required=True, help="Channel ID with 'UC' replaced by 'UU'"), P("key", "API key", "password", True, secret=True)],
     {"base": "https://www.googleapis.com/youtube/v3", "endpoint": "/playlistItems", "query": {"part": "snippet,contentDetails", "playlistId": "{playlist}", "maxResults": "50", "key": "{key}"},
      "records": "items", "paginate": {"type": "cursor", "param": "pageToken", "path": "nextPageToken"}}, "Videos uploaded by a channel.")
saas("meta_ads", "Meta (Facebook) Ads insights", MKT, [P("account", "Ad account ID (numbers only)", required=True), token("Access token"), P("level", "Level", "select", default="campaign", options=["account", "campaign", "adset", "ad"]),
     P("date_preset", "Date preset", default="last_30d"), P("fields", "Fields", default="campaign_name,impressions,clicks,spend,cpc,ctr,reach"), P("version", "Graph API version", default="v21.0", advanced=True)],
     {"base": "https://graph.facebook.com/{version}", "endpoint": "/act_{account}/insights", "query": {"level": "{level}", "date_preset": "{date_preset}", "fields": "{fields}", "time_increment": "1", "access_token": "{token}"},
      "records": "data", "paginate": {"type": "next_url", "path": "paging.next"}}, "Ad performance by day.")
saas("mailchimp", "Mailchimp", MKT, [res({"Campaign reports": 0, "Audience members": 0, "Campaigns": 0}), P("dc", "Data centre", required=True, placeholder="us21"), P("list_id", "Audience ID (for members)"), token("API key")],
     {"base": "https://{dc}.api.mailchimp.com/3.0", "resources": {"Campaign reports": {"endpoint": "/reports", "records": "reports"}, "Audience members": {"endpoint": "/lists/{list_id}/members", "records": "members"},
      "Campaigns": {"endpoint": "/campaigns", "records": "campaigns"}}, "auth": {"type": "basic", "user": "pybi", "password": "{token}"},
      "paginate": {"type": "offset", "param": "offset", "size_param": "count", "size": 1000, "total": "total_items"}}, "Campaign performance and audiences.")
saas("klaviyo", "Klaviyo", MKT, [res({"Profiles": 0, "Campaigns": 0, "Events": 0}), token("Private API key")],
     {"base": "https://a.klaviyo.com/api", "resources": {"Profiles": {"endpoint": "/profiles"}, "Campaigns": {"endpoint": "/campaigns", "query": {"filter": "equals(messages.channel,'email')"}}, "Events": {"endpoint": "/events"}},
      "headers": {"Authorization": "Klaviyo-API-Key {token}", "revision": "2024-10-15"}, "records": "data", "post": "attributes", "paginate": {"type": "next_url", "path": "links.next"}}, "Profiles, campaigns, events.")
saas("sendgrid", "SendGrid stats", MKT, [P("start", "Start date", required=True, placeholder="2025-01-01"), token("API key")],
     {"base": "https://api.sendgrid.com/v3", "endpoint": "/stats", "query": {"start_date": "{start}", "aggregated_by": "day"}, "auth": {"type": "bearer", "token": "{token}"}, "records": ""}, "Email delivery stats per day.")
saas("brevo", "Brevo (Sendinblue)", MKT, [res({"Contacts": 0, "Email campaigns": 0}), token("API key")],
     {"base": "https://api.brevo.com/v3", "resources": {"Contacts": {"endpoint": "/contacts", "records": "contacts"}, "Email campaigns": {"endpoint": "/emailCampaigns", "records": "campaigns"}},
      "headers": {"api-key": "{token}"}, "paginate": {"type": "offset", "param": "offset", "size_param": "limit", "size": 50, "total": "count"}}, "Contacts and campaigns.")
saas("typeform", "Typeform responses", MKT, [P("form", "Form ID", required=True), token("Personal token")],
     {"base": "https://api.typeform.com", "endpoint": "/forms/{form}/responses", "query": {"page_size": "1000"}, "auth": {"type": "bearer", "token": "{token}"}, "records": "items"}, "Form submissions.")
saas("surveymonkey", "SurveyMonkey", MKT, [P("survey", "Survey ID", required=True), token("Access token")],
     {"base": "https://api.surveymonkey.com/v3", "endpoint": "/surveys/{survey}/responses/bulk", "query": {"per_page": "100"}, "auth": {"type": "bearer", "token": "{token}"},
      "records": "data", "paginate": {"type": "next_url", "path": "links.next"}}, "Survey responses.")
saas("jotform", "Jotform", MKT, [P("form", "Form ID", required=True), P("key", "API key", "password", True, secret=True)],
     {"base": "https://api.jotform.com", "endpoint": "/form/{form}/submissions", "query": {"apiKey": "{key}", "limit": "1000"}, "records": "content",
      "paginate": {"type": "offset", "param": "offset", "size": 1000}}, "Form submissions.")
saas("eventbrite", "Eventbrite", MKT, [P("org", "Organization ID", required=True), token("Private token")],
     {"base": "https://www.eventbriteapi.com/v3", "endpoint": "/organizations/{org}/events/", "auth": {"type": "bearer", "token": "{token}"}, "records": "events",
      "paginate": {"type": "cursor", "param": "continuation", "path": "pagination.continuation", "more": "pagination.has_more_items"}}, "Events.")
saas("calendly", "Calendly", MKT, [P("user", "User URI", required=True, placeholder="https://api.calendly.com/users/XXXX"), token("Personal access token")],
     {"base": "https://api.calendly.com", "endpoint": "/scheduled_events", "query": {"user": "{user}", "count": "100"}, "auth": {"type": "bearer", "token": "{token}"},
      "records": "collection", "paginate": {"type": "next_url", "path": "pagination.next_page"}}, "Scheduled meetings.")
saas("webflow", "Webflow CMS", ECOM, [P("collection", "Collection ID", required=True), token("API token")],
     {"base": "https://api.webflow.com/v2", "endpoint": "/collections/{collection}/items", "auth": {"type": "bearer", "token": "{token}"}, "records": "items",
      "paginate": {"type": "offset", "param": "offset", "size_param": "limit", "size": 100, "total": "pagination.total"}}, "CMS collection items.")

# ---- support & ITSM
ZD = {"Tickets": ("/tickets.json", "tickets"), "Users": ("/users.json", "users"), "Organizations": ("/organizations.json", "organizations"), "Satisfaction ratings": ("/satisfaction_ratings.json", "satisfaction_ratings")}
saas("zendesk", "Zendesk Support", SUP, [res(ZD), P("subdomain", "Subdomain", required=True), P("email", "Agent email", required=True), token()],
     {"base": "https://{subdomain}.zendesk.com/api/v2", "resources": {k: {"endpoint": e, "records": r} for k, (e, r) in ZD.items()},
      "auth": {"type": "basic", "user": "{email}/token", "password": "{token}"}, "paginate": {"type": "next_url", "path": "next_page"}}, "Tickets, users, CSAT.")
saas("freshdesk", "Freshdesk", SUP, [res({"Tickets": 0, "Contacts": 0, "Agents": 0}), P("domain", "Domain", required=True, placeholder="yourcompany"), token("API key")],
     {"base": "https://{domain}.freshdesk.com/api/v2", "resources": {"Tickets": {"endpoint": "/tickets", "query": {"updated_since": "2000-01-01T00:00:00Z"}}, "Contacts": {"endpoint": "/contacts"}, "Agents": {"endpoint": "/agents"}},
      "query": {"per_page": "100"}, "auth": {"type": "basic", "user": "{token}", "password": "X"}, "records": "", "paginate": {"type": "page", "param": "page", "size": 100}}, "Tickets and contacts.")
saas("freshservice", "Freshservice", SUP, [P("domain", "Domain", required=True), token("API key")],
     {"base": "https://{domain}.freshservice.com/api/v2", "endpoint": "/tickets", "query": {"per_page": "100"}, "auth": {"type": "basic", "user": "{token}", "password": "X"}, "records": "tickets",
      "paginate": {"type": "page", "param": "page", "size": 100}}, "IT service tickets.")
saas("intercom", "Intercom", SUP, [res({"Contacts": 0, "Conversations": 0, "Companies": 0}), token("Access token")],
     {"base": "https://api.intercom.io", "resources": {"Contacts": {"endpoint": "/contacts", "records": "data"}, "Conversations": {"endpoint": "/conversations", "records": "conversations"},
      "Companies": {"endpoint": "/companies", "records": "data"}}, "query": {"per_page": "150"}, "headers": {"Intercom-Version": "2.11"}, "auth": {"type": "bearer", "token": "{token}"},
      "paginate": {"type": "cursor", "param": "starting_after", "path": "pages.next.starting_after"}}, "Contacts and conversations.")
saas("servicenow", "ServiceNow", SUP, [P("instance", "Instance", required=True, placeholder="dev12345"), P("table", "Table", default="incident"), P("user", "Username", required=True),
     P("password", "Password", "password", True, secret=True), P("sysparm_query", "Encoded query", advanced=True)],
     {"base": "https://{instance}.service-now.com/api/now", "endpoint": "/table/{table}", "query": {"sysparm_query": "{sysparm_query}", "sysparm_display_value": "true"},
      "auth": {"type": "basic", "user": "{user}", "password": "{password}"}, "records": "result", "paginate": {"type": "offset", "param": "sysparm_offset", "size_param": "sysparm_limit", "size": 1000}}, "Any ServiceNow table.")
saas("helpscout", "Help Scout", SUP, [token("OAuth access token")],
     {"base": "https://api.helpscout.net/v2", "endpoint": "/conversations", "query": {"status": "all"}, "auth": {"type": "bearer", "token": "{token}"},
      "records": "_embedded.conversations", "paginate": {"type": "next_url", "path": "_links.next.href"}}, "Conversations.")
saas("okta", "Okta users", SUP, [P("domain", "Okta domain", required=True, placeholder="yourcompany.okta.com"), token("API token")],
     {"base": "https://{domain}/api/v1", "endpoint": "/users", "query": {"limit": "200"}, "headers": {"Authorization": "SSWS {token}"}, "records": "", "paginate": {"type": "link"}}, "Directory users.")
saas("twilio", "Twilio messages", SUP, [P("sid", "Account SID", required=True), token("Auth token")],
     {"base": "https://api.twilio.com", "endpoint": "/2010-04-01/Accounts/{sid}/Messages.json", "query": {"PageSize": "1000"}, "auth": {"type": "basic", "user": "{sid}", "password": "{token}"},
      "records": "messages", "paginate": {"type": "next_url", "path": "next_page_uri", "origin": "https://api.twilio.com"}}, "SMS / WhatsApp message logs.")
saas("slack", "Slack", PM, [res({"Channel messages": 0, "Users": 0, "Channels": 0}), P("channel", "Channel ID (for messages)"), token("Bot token (xoxb-…)")],
     {"base": "https://slack.com/api", "resources": {"Channel messages": {"endpoint": "/conversations.history", "query": {"channel": "{channel}"}, "records": "messages"},
      "Users": {"endpoint": "/users.list", "records": "members"}, "Channels": {"endpoint": "/conversations.list", "records": "channels"}},
      "query": {"limit": "200"}, "auth": {"type": "bearer", "token": "{token}"}, "paginate": {"type": "cursor", "param": "cursor", "path": "response_metadata.next_cursor"}}, "Messages, users, channels.")

# ---- HR & time tracking
saas("bamboohr", "BambooHR", HR, [P("company", "Company domain", required=True), token("API key")],
     {"base": "https://api.bamboohr.com/api/gateway.php/{company}/v1", "endpoint": "/employees/directory", "auth": {"type": "basic", "user": "{token}", "password": "x"}, "records": "employees"}, "Employee directory.")
saas("greenhouse", "Greenhouse", HR, [res({"Candidates": 0, "Applications": 0, "Jobs": 0}), token("Harvest API key")],
     {"base": "https://harvest.greenhouse.io/v1", "resources": {"Candidates": {"endpoint": "/candidates"}, "Applications": {"endpoint": "/applications"}, "Jobs": {"endpoint": "/jobs"}},
      "query": {"per_page": "500"}, "auth": {"type": "basic", "user": "{token}", "password": ""}, "records": "", "paginate": {"type": "link"}}, "Recruiting pipeline.")
saas("harvest", "Harvest", HR, [res({"Time entries": 0, "Projects": 0, "Invoices": 0}), P("account", "Account ID", required=True), token("Personal access token")],
     {"base": "https://api.harvestapp.com/v2", "resources": {"Time entries": {"endpoint": "/time_entries", "records": "time_entries"}, "Projects": {"endpoint": "/projects", "records": "projects"},
      "Invoices": {"endpoint": "/invoices", "records": "invoices"}}, "headers": {"Harvest-Account-Id": "{account}"}, "auth": {"type": "bearer", "token": "{token}"},
      "paginate": {"type": "next_url", "path": "links.next"}}, "Time, projects, invoices.")
saas("toggl", "Toggl Track", HR, [token("API token"), P("start", "Start date", placeholder="2025-01-01"), P("end", "End date", placeholder="2025-01-31")],
     {"base": "https://api.track.toggl.com/api/v9", "endpoint": "/me/time_entries", "query": {"start_date": "{start}", "end_date": "{end}"},
      "auth": {"type": "basic", "user": "{token}", "password": "api_token"}, "records": ""}, "Your time entries.")
saas("clockify", "Clockify", HR, [P("workspace", "Workspace ID", required=True), P("user", "User ID", required=True), token("API key")],
     {"base": "https://api.clockify.me/api/v1", "endpoint": "/workspaces/{workspace}/user/{user}/time-entries", "headers": {"X-Api-Key": "{token}"}, "records": "",
      "paginate": {"type": "page", "param": "page", "size_param": "page-size", "size": 200}}, "Time entries.")

# ---- e-commerce & CMS
saas("shopify", "Shopify", ECOM, [res({"Orders": "orders", "Products": "products", "Customers": "customers"}), P("shop", "Shop", required=True, placeholder="yourstore.myshopify.com"), token("Admin API access token"),
     P("version", "API version", default="2025-01", advanced=True)],
     {"base": "https://{shop}/admin/api/{version}", "resources": {"Orders": {"endpoint": "/orders.json", "query": {"status": "any"}, "records": "orders"}, "Products": {"endpoint": "/products.json", "records": "products"},
      "Customers": {"endpoint": "/customers.json", "records": "customers"}}, "query": {"limit": "250"}, "headers": {"X-Shopify-Access-Token": "{token}"}, "paginate": {"type": "link"}}, "Orders, products, customers.")
saas("woocommerce", "WooCommerce", ECOM, [res({"Orders": 0, "Products": 0, "Customers": 0}), P("site", "Store URL", required=True, placeholder="https://shop.example.com"), P("key", "Consumer key", required=True),
     P("secret", "Consumer secret", "password", True, secret=True)],
     {"base": "{site}/wp-json/wc/v3", "resources": {"Orders": {"endpoint": "/orders"}, "Products": {"endpoint": "/products"}, "Customers": {"endpoint": "/customers"}},
      "auth": {"type": "basic", "user": "{key}", "password": "{secret}"}, "records": "", "paginate": {"type": "page", "param": "page", "size_param": "per_page", "size": 100}}, "Store data.")
saas("bigcommerce", "BigCommerce", ECOM, [res({"Orders": 0, "Products": 0}), P("store", "Store hash", required=True), token("Access token")],
     {"base": "https://api.bigcommerce.com/stores/{store}", "resources": {"Orders": {"endpoint": "/v2/orders", "records": ""}, "Products": {"endpoint": "/v3/catalog/products", "records": "data"}},
      "headers": {"X-Auth-Token": "{token}"}, "paginate": {"type": "page", "param": "page", "size_param": "limit", "size": 250}}, "Orders and catalog.")
saas("wordpress", "WordPress", ECOM, [res({"Posts": 0, "Pages": 0, "Comments": 0}), P("site", "Site URL", required=True)],
     {"base": "{site}/wp-json/wp/v2", "resources": {"Posts": {"endpoint": "/posts"}, "Pages": {"endpoint": "/pages"}, "Comments": {"endpoint": "/comments"}}, "records": "",
      "paginate": {"type": "page", "param": "page", "size_param": "per_page", "size": 100}}, "Posts, pages, comments.")
saas("contentful", "Contentful", ECOM, [P("space", "Space ID", required=True), P("content_type", "Content type ID"), token("Delivery API token"), P("environment", "Environment", default="master", advanced=True)],
     {"base": "https://cdn.contentful.com", "endpoint": "/spaces/{space}/environments/{environment}/entries", "query": {"content_type": "{content_type}"}, "auth": {"type": "bearer", "token": "{token}"},
      "records": "items", "paginate": {"type": "offset", "param": "skip", "size_param": "limit", "size": 1000, "total": "total"}}, "CMS entries.")
saas("strapi", "Strapi", ECOM, [P("host", "Strapi URL", required=True), P("collection", "Collection (plural API ID)", required=True), token("API token")],
     {"base": "{host}/api", "endpoint": "/{collection}", "auth": {"type": "bearer", "token": "{token}"}, "records": "data",
      "paginate": {"type": "page", "param": "pagination[page]", "size_param": "pagination[pageSize]", "size": 100, "total_pages": "meta.pagination.pageCount"}}, "Headless CMS collections.")
saas("gumroad", "Gumroad sales", ECOM, [token("Access token")],
     {"base": "https://api.gumroad.com/v2", "endpoint": "/sales", "query": {"access_token": "{token}"}, "records": "sales", "paginate": {"type": "cursor", "param": "page_key", "path": "next_page_key"}}, "Sales.")

# ---- Microsoft & Google
saas("ms_graph", "Microsoft Graph (any endpoint)", MS, [P("path", "Graph path", required=True, default="/users"), token("Access token")],
     {"base": "https://graph.microsoft.com/v1.0", "endpoint": "{path}", "auth": {"type": "bearer", "token": "{token}"}, "records": "value", "paginate": {"type": "next_url", "path": "@odata.nextLink"}},
     "Users, groups, mail, Teams, Planner… via Graph.")
saas("sharepoint_list", "SharePoint Online list", MS, [P("site", "Site ID", required=True), P("list", "List name or ID", required=True), token("Graph access token")],
     {"base": "https://graph.microsoft.com/v1.0", "endpoint": "/sites/{site}/lists/{list}/items", "query": {"expand": "fields"}, "auth": {"type": "bearer", "token": "{token}"}, "records": "value",
      "paginate": {"type": "next_url", "path": "@odata.nextLink"}}, "List items (fields as columns).")
saas("business_central", "Dynamics 365 Business Central", MS, [P("tenant", "Tenant ID", required=True), P("environment", "Environment", default="production"), P("company", "Company ID", required=True),
     P("entity", "Entity", default="salesInvoices"), token("Access token")],
     {"base": "https://api.businesscentral.dynamics.com/v2.0/{tenant}/{environment}/api/v2.0", "endpoint": "/companies({company})/{entity}", "auth": {"type": "bearer", "token": "{token}"},
      "records": "value", "paginate": {"type": "next_url", "path": "@odata.nextLink"}}, "ERP entities via the BC API.")
saas("planner", "Microsoft Planner tasks", MS, [P("plan", "Plan ID", required=True), token("Graph access token")],
     {"base": "https://graph.microsoft.com/v1.0", "endpoint": "/planner/plans/{plan}/tasks", "auth": {"type": "bearer", "token": "{token}"}, "records": "value"}, "Tasks of a plan.")
saas("gsheets_api", "Google Sheets (API)", MS, [P("spreadsheet", "Spreadsheet ID", required=True), P("range", "Range / sheet name", default="Sheet1"), P("key", "API key", "password", secret=True),
     P("token", "OAuth access token (private sheets)", "password", secret=True, advanced=True)],
     {"base": "https://sheets.googleapis.com/v4", "endpoint": "/spreadsheets/{spreadsheet}/values/{range}", "query": {"key": "{key}"}, "auth": {"type": "bearer", "token": "{token}"},
      "records": "values", "post": "values_table"}, "Any range of a Google Sheet (first row = headers).")
saas("gcalendar", "Google Calendar", MS, [P("calendar", "Calendar ID", default="primary"), token("OAuth access token")],
     {"base": "https://www.googleapis.com/calendar/v3", "endpoint": "/calendars/{calendar}/events", "query": {"singleEvents": "true", "maxResults": "2500"}, "auth": {"type": "bearer", "token": "{token}"},
      "records": "items", "paginate": {"type": "cursor", "param": "pageToken", "path": "nextPageToken"}}, "Calendar events.")
saas("gsc", "Google Search Console", MS, [P("site", "Site URL", required=True, placeholder="sc-domain:example.com"), P("start", "Start date", required=True), P("end", "End date", required=True),
     P("dims", "Dimensions", default="date"), token("OAuth access token")],
     {"base": "https://searchconsole.googleapis.com/webmasters/v3", "endpoint": "/sites/{site}/searchAnalytics/query", "method": "POST",
      "body_fn": "gsc", "auth": {"type": "bearer", "token": "{token}"}, "records": "rows"}, "Clicks, impressions, CTR, position.")

# ================================================================== PUBLIC & FINANCIAL DATA
PUB = "Public data"
saas("worldbank", "World Bank indicators", PUB, [P("indicator", "Indicator code", required=True, default="NY.GDP.MKTP.CD", help="e.g. SP.POP.TOTL population, NY.GDP.PCAP.CD GDP per capita"),
     P("country", "Countries (ISO3, ; separated or all)", default="all"), P("date", "Years", default="2000:2024")],
     {"base": "https://api.worldbank.org/v2", "endpoint": "/country/{country}/indicator/{indicator}", "query": {"format": "json", "per_page": "20000", "date": "{date}"},
      "records": "1", "post": "worldbank", "paginate": {"type": "page", "param": "page", "total_pages": "0.pages"}}, "16,000+ development indicators.")
saas("fred", "FRED economic data", PUB, [P("series", "Series ID", required=True, default="CPIAUCSL"), P("key", "API key", "password", True, secret=True)],
     {"base": "https://api.stlouisfed.org/fred", "endpoint": "/series/observations", "query": {"series_id": "{series}", "api_key": "{key}", "file_type": "json"}, "records": "observations", "post": "fred"},
     "800,000+ US & international economic time series.")
saas("coingecko", "CoinGecko crypto markets", PUB, [P("vs", "Currency", default="usd")],
     {"base": "https://api.coingecko.com/api/v3", "endpoint": "/coins/markets", "query": {"vs_currency": "{vs}", "per_page": "250", "order": "market_cap_desc"}, "records": "",
      "paginate": {"type": "page", "param": "page", "size": 250}, "max_pages": 4}, "Prices, market cap and volume of top coins.")
saas("coingecko_history", "CoinGecko price history", PUB, [P("coin", "Coin ID", default="bitcoin", required=True), P("vs", "Currency", default="usd"), P("days", "Days", default="365")],
     {"base": "https://api.coingecko.com/api/v3", "endpoint": "/coins/{coin}/market_chart", "query": {"vs_currency": "{vs}", "days": "{days}"}, "records": "prices", "post": "pairs"}, "Daily price history.")
saas("openmeteo", "Open-Meteo weather history", PUB, [P("latitude", "Latitude", required=True, default="24.86"), P("longitude", "Longitude", required=True, default="67.01"),
     P("start", "Start date", required=True, default="2025-01-01"), P("end", "End date", required=True, default="2025-06-30"),
     P("daily", "Daily variables", default="temperature_2m_max,temperature_2m_min,precipitation_sum,wind_speed_10m_max")],
     {"base": "https://archive-api.open-meteo.com/v1", "endpoint": "/archive", "query": {"latitude": "{latitude}", "longitude": "{longitude}", "start_date": "{start}", "end_date": "{end}", "daily": "{daily}", "timezone": "auto"},
      "records": "daily", "post": "columns"}, "Free historical weather for any location (defaults to Karachi).")
saas("restcountries", "REST Countries", PUB, [P("fields", "Fields", default="name,cca3,region,subregion,population,area,capital,currencies")],
     {"base": "https://restcountries.com/v3.1", "endpoint": "/all", "query": {"fields": "{fields}"}, "records": ""}, "Every country: population, area, region, currencies.")
saas("fx_rates", "Exchange rates (ECB)", PUB, [P("base_ccy", "Base currency", default="USD"), P("start", "Start date", required=True, default="2025-01-01"), P("end", "End date", default="")],
     {"base": "https://api.frankfurter.app", "endpoint": "/{start}..{end}", "query": {"from": "{base_ccy}"}, "records": "rates", "post": "date_dict"}, "Daily reference rates from the European Central Bank.")
saas("alphavantage", "Alpha Vantage stocks", PUB, [P("symbol", "Symbol", required=True, default="MSFT"), P("function", "Function", "select", default="TIME_SERIES_DAILY",
     options=["TIME_SERIES_DAILY", "TIME_SERIES_WEEKLY", "TIME_SERIES_MONTHLY", "FX_DAILY"]), P("key", "API key", "password", True, secret=True)],
     {"base": "https://www.alphavantage.co", "endpoint": "/query", "query": {"function": "{function}", "symbol": "{symbol}", "apikey": "{key}", "datatype": "csv", "outputsize": "full"}, "format": "csv"}, "Stock & FX prices.")
add(Connector("yfinance", "Yahoo Finance", PUB, "yfinance", [P("tickers", "Tickers", required=True, default="AAPL, MSFT, GOOGL"), P("start", "Start date", default="2024-01-01"), P("end", "End date"),
    P("interval", "Interval", "select", default="1d", options=["1d", "1wk", "1mo", "1h"])], {}, "Daily prices for stocks, ETFs, indices, FX and crypto.", "yfinance"))
saas("census", "US Census Bureau", PUB, [P("dataset", "Dataset path", default="2022/acs/acs5"), P("get", "Variables", default="NAME,B01001_001E"), P("for_", "Geography", default="state:*"),
     P("key", "API key (optional)", "password", secret=True)],
     {"base": "https://api.census.gov/data", "endpoint": "/{dataset}", "query": {"get": "{get}", "for": "{for_}", "key": "{key}"}, "records": "", "post": "values_table"}, "ACS, decennial and economic census data.")
saas("socrata", "Socrata open data (SODA)", PUB, [P("domain", "Portal domain", required=True, placeholder="data.cityofnewyork.us"), P("dataset", "Dataset ID", required=True, placeholder="erm2-nwe9"),
     P("where", "$where filter", advanced=True), P("app_token", "App token", "password", secret=True, advanced=True)],
     {"base": "https://{domain}/resource", "endpoint": "/{dataset}.json", "query": {"$where": "{where}", "$$app_token": "{app_token}"}, "records": "",
      "paginate": {"type": "offset", "param": "$offset", "size_param": "$limit", "size": 50000}}, "Thousands of government open-data portals.")
saas("ckan", "CKAN open data (data.gov…)", PUB, [P("host", "Portal URL", required=True, placeholder="https://catalog.data.gov"), P("resource_id", "Resource ID", required=True)],
     {"base": "{host}/api/3/action", "endpoint": "/datastore_search", "query": {"resource_id": "{resource_id}"}, "records": "result.records",
      "paginate": {"type": "offset", "param": "offset", "size_param": "limit", "size": 10000, "total": "result.total"}}, "CKAN DataStore resources.")
saas("eurostat", "Eurostat", PUB, [P("dataset", "Dataset code", required=True, default="nama_10_gdp")],
     {"base": "https://ec.europa.eu/eurostat/api/dissemination/sdmx/2.1", "endpoint": "/data/{dataset}", "query": {"format": "SDMX-CSV"}, "format": "csv"}, "EU statistics (SDMX-CSV).")
saas("oecd", "OECD data (SDMX)", PUB, [P("flow", "Dataflow (agency,id,version)", required=True, default="OECD.SDD.NAD,DSD_NAMAIN1@DF_QNA,1.1"), P("key", "Key", default="all")],
     {"base": "https://sdmx.oecd.org/public/rest", "endpoint": "/data/{flow}/{key}", "query": {"format": "csvfile"}, "format": "csv"}, "OECD statistics.")
saas("imf", "IMF DataMapper", PUB, [P("indicator", "Indicator", required=True, default="NGDP_RPCH")],
     {"base": "https://www.imf.org/external/datamapper/api/v1", "endpoint": "/{indicator}", "records": "values.{indicator}", "post": "imf"}, "IMF World Economic Outlook indicators.")
saas("usgs_quakes", "USGS earthquakes", PUB, [P("period", "Feed", "select", default="all_month", options=["all_hour", "all_day", "all_week", "all_month", "significant_month"])],
     {"base": "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary", "endpoint": "/{period}.geojson", "records": "features"}, "Live global earthquake feed.")
saas("nasa_power", "NASA POWER climate", PUB, [P("latitude", "Latitude", default="24.86"), P("longitude", "Longitude", default="67.01"), P("start", "Start (YYYYMMDD)", default="20240101"),
     P("end", "End (YYYYMMDD)", default="20241231"), P("parameters", "Parameters", default="T2M,PRECTOTCORR,ALLSKY_SFC_SW_DWN")],
     {"base": "https://power.larc.nasa.gov/api/temporal/daily", "endpoint": "/point", "query": {"parameters": "{parameters}", "community": "RE", "longitude": "{longitude}", "latitude": "{latitude}",
      "start": "{start}", "end": "{end}", "format": "CSV", "header": "false"}, "format": "csv"}, "Solar & meteorological daily data.")
add(Connector("kaggle", "Kaggle dataset", PUB, "kaggle", [P("dataset", "Dataset", required=True, placeholder="owner/dataset-name"), P("pattern", "File pattern", default="*")],
    {}, "Download and load a Kaggle dataset (uses ~/.kaggle/kaggle.json).", "kaggle"))
saas("hackernews", "Hacker News top stories", PUB, [P("tags", "Tags", default="front_page")],
     {"base": "https://hn.algolia.com/api/v1", "endpoint": "/search", "query": {"tags": "{tags}", "hitsPerPage": "100"}, "records": "hits"}, "Stories via the Algolia HN API.")


# ------------------------------------------------------------------ helpers for generic presets
def _finish():
    seen = set()
    for c in CATALOG:
        if c.id in seen:
            raise RuntimeError(f"duplicate connector id {c.id}")
        seen.add(c.id)


_finish()
BY_ID: Dict[str, Connector] = {c.id: c for c in CATALOG}
CATEGORIES = list(dict.fromkeys(c.category for c in CATALOG))
