"""Built-in demo dataset and starter report so a new user sees a working dashboard instantly."""
from __future__ import annotations

import numpy as np
import pandas as pd


def calendar_table(start, end) -> pd.DataFrame:
    dates = pd.date_range(pd.Timestamp(start).normalize(), pd.Timestamp(end).normalize(), freq="D")
    return pd.DataFrame({
        "Date": dates,
        "Year": dates.year,
        "Quarter": "Q" + dates.quarter.astype(str),
        "Month Number": dates.month,
        "Month Name": dates.strftime("%b"),
        "Year-Month": dates.strftime("%Y-%m"),
        "Weekday": dates.strftime("%a"),
        "Weekday Number": dates.weekday + 1,
    })


def sample_tables(seed: int = 7):
    rng = np.random.default_rng(seed)
    products = pd.DataFrame([
        (1, "Trail Bike X1", "Bikes", "Mountain", 1450, 820), (2, "Road Racer R5", "Bikes", "Road", 1890, 1100),
        (3, "City Cruiser", "Bikes", "Urban", 690, 380), (4, "E-Bike Volt", "Bikes", "Electric", 2650, 1650),
        (5, "Kids Sprint", "Bikes", "Kids", 320, 170), (6, "Pro Helmet", "Accessories", "Safety", 120, 48),
        (7, "LED Light Set", "Accessories", "Safety", 45, 16), (8, "Bottle Cage", "Accessories", "Gear", 18, 6),
        (9, "Saddle Bag", "Accessories", "Gear", 55, 22), (10, "Rider Jersey", "Clothing", "Tops", 75, 30),
        (11, "Winter Gloves", "Clothing", "Gloves", 38, 14), (12, "Cycling Shorts", "Clothing", "Bottoms", 65, 26),
        (13, "Rain Jacket", "Clothing", "Tops", 140, 62), (14, "Tube Repair Kit", "Components", "Repair", 25, 9),
        (15, "Carbon Wheelset", "Components", "Wheels", 980, 560), (16, "Disc Brake Set", "Components", "Brakes", 210, 105),
    ], columns=["ProductID", "Product", "Category", "Subcategory", "ListPrice", "UnitCost"])

    cities = [("Karachi", "South"), ("Hyderabad", "South"), ("Lahore", "Central"), ("Faisalabad", "Central"),
              ("Multan", "Central"), ("Islamabad", "North"), ("Peshawar", "North"), ("Quetta", "West"),
              ("Dubai", "International"), ("London", "International")]
    segments = ["Consumer", "Corporate", "Small Business", "Government"]
    first = ["Ali", "Sara", "Usman", "Ayesha", "Bilal", "Fatima", "Hamza", "Zainab", "Omar", "Hira", "Imran", "Mehwish"]
    last = ["Traders", "Enterprises", "Cycles", "Sports", "Group", "Store", "& Co", "Outdoors"]
    n_cust = 160
    cust_city = rng.integers(0, len(cities), n_cust)
    customers = pd.DataFrame({
        "CustomerID": np.arange(1001, 1001 + n_cust),
        "Customer": [f"{first[i % len(first)]} {last[(i * 7) % len(last)]} {i + 1}" for i in range(n_cust)],
        "City": [cities[i][0] for i in cust_city],
        "Region": [cities[i][1] for i in cust_city],
        "Segment": rng.choice(segments, n_cust, p=[0.45, 0.25, 0.22, 0.08]),
    })

    start, end = pd.Timestamp("2023-01-01"), pd.Timestamp("2025-12-31")
    days = pd.date_range(start, end, freq="D")
    n_orders = 5200
    t = rng.random(n_orders) ** 0.85  # growth: more orders later
    seasonal = rng.random(n_orders)
    idx = (t * (len(days) - 1)).astype(int)
    order_dates = days[idx]
    # seasonal push: shift some orders towards spring/summer & Nov-Dec
    month_boost = np.isin(order_dates.month, [4, 5, 6, 11, 12])
    keep = month_boost | (seasonal > 0.25)
    order_dates = order_dates[keep]
    n = len(order_dates)
    lines = rng.integers(1, 4, n)
    rows = []
    oid = 50001
    pw = np.array([5, 4, 7, 3, 4, 9, 10, 12, 8, 9, 7, 8, 5, 11, 2, 4], dtype=float)
    pw /= pw.sum()
    for d, k in zip(order_dates, lines):
        cust = int(customers.CustomerID.iloc[rng.integers(0, n_cust)])
        for _ in range(k):
            p = int(rng.choice(products.ProductID, p=pw))
            price = float(products.ListPrice.iloc[p - 1])
            qty = int(rng.integers(1, 4 if price > 500 else 7))
            disc = float(rng.choice([0, 0, 0, 0.05, 0.1, 0.15]))
            rows.append((oid, d, cust, p, qty, price, disc))
        oid += 1
    sales = pd.DataFrame(rows, columns=["OrderID", "OrderDate", "CustomerID", "ProductID", "Quantity", "UnitPrice", "Discount"])
    sales = sales.sort_values("OrderDate").reset_index(drop=True)
    targets = pd.DataFrame({"Region": ["South", "Central", "North", "West", "International"],
                            "Annual Target": [820_000, 720_000, 450_000, 115_000, 330_000]})
    return {"Sales": sales, "Products": products, "Customers": customers,
            "Calendar": calendar_table(start, end), "Targets": targets}


def _v(id_, type_, x, y, w, h, title="", fields=None, **fmt):
    return {"id": id_, "type": type_, "x": x, "y": y, "w": w, "h": h, "title": title,
            "fields": fields or {}, "format": fmt}


def M(name):
    return {"measure": name}


def C(table, column, level=None, agg=None):
    f = {"table": table, "column": column}
    if level:
        f["level"] = level
    if agg:
        f["agg"] = agg
    return f


def sample_report() -> dict:
    measures = [
        ("Total Revenue", "SUM(Sales[Revenue])", {"type": "currency", "symbol": "$"}),
        ("Total Cost", "SUM(Sales[Cost])", {"type": "currency", "symbol": "$"}),
        ("Profit", "[Total Revenue] - [Total Cost]", {"type": "currency", "symbol": "$"}),
        ("Profit Margin", "DIVIDE([Profit], [Total Revenue])", {"type": "percent", "decimals": 1}),
        ("Orders", "DISTINCTCOUNT(Sales[OrderID])", {"type": "whole"}),
        ("Units Sold", "SUM(Sales[Quantity])", {"type": "whole"}),
        ("Avg Order Value", "DIVIDE([Total Revenue], [Orders])", {"type": "currency", "symbol": "$", "decimals": 0}),
        ("Revenue LY", "CALCULATE([Total Revenue], SAMEPERIODLASTYEAR('Calendar'[Date]))", {"type": "currency", "symbol": "$"}),
        ("Revenue YoY %", "DIVIDE([Total Revenue] - [Revenue LY], [Revenue LY])", {"type": "percent", "decimals": 1}),
        ("Revenue YTD", "TOTALYTD([Total Revenue], 'Calendar'[Date])", {"type": "currency", "symbol": "$"}),
        ("% of Total", "DIVIDE([Total Revenue], CALCULATE([Total Revenue], ALLSELECTED(Sales)))", {"type": "percent", "decimals": 1}),
        ("Product Rank", "RANKX(ALL(Products), [Total Revenue])", {"type": "whole"}),
        ("Revenue Target", "VAR yearly = SUM(Targets[Annual Target])\nVAR years = DISTINCTCOUNT('Calendar'[Year])\nRETURN yearly * years", {"type": "currency", "symbol": "$"}),
        ("Target Achievement", "DIVIDE([Total Revenue], [Revenue Target])", {"type": "percent", "decimals": 0}),
    ]
    page1 = [
        _v("v_title", "textbox", 20, 12, 900, 52, "", text="Sales Performance Dashboard",
           fontSize=26, bold=True, color="#1f2937", background="transparent", border=False),
        _v("v_sl_year", "slicer", 940, 10, 150, 60, "Year", {"category": [C("Calendar", "Year")]}, style="dropdown"),
        _v("v_sl_region", "slicer", 1100, 10, 160, 60, "Region", {"category": [C("Customers", "Region")]}, style="dropdown"),
        _v("v_c1", "card", 20, 76, 300, 112, "", {"values": [M("Total Revenue")]}),
        _v("v_c2", "card", 334, 76, 300, 112, "", {"values": [M("Profit")]}),
        _v("v_c3", "card", 648, 76, 300, 112, "", {"values": [M("Profit Margin")]}),
        _v("v_c4", "card", 962, 76, 298, 112, "", {"values": [M("Orders")]}),
        _v("v_line", "line", 20, 202, 760, 250, "Revenue vs Last Year by Month",
           {"category": [C("Calendar", "Year-Month")], "values": [M("Total Revenue"), M("Revenue LY")]}, smooth=True, markers=False),
        _v("v_donut", "donut", 794, 202, 466, 250, "Revenue by Segment",
           {"category": [C("Customers", "Segment")], "values": [M("Total Revenue")]}),
        _v("v_col", "clusteredColumn", 20, 466, 420, 238, "Revenue by Category",
           {"category": [C("Products", "Category")], "values": [M("Total Revenue")]}, dataLabels=True),
        _v("v_bar", "clusteredBar", 454, 466, 420, 238, "Profit by Region",
           {"category": [C("Customers", "Region")], "values": [M("Profit")]}, dataLabels=True),
        _v("v_gauge", "gauge", 888, 466, 372, 238, "Target Achievement",
           {"values": [M("Total Revenue")], "target": [M("Revenue Target")]}),
    ]
    page2 = [
        _v("v2_title", "textbox", 20, 12, 700, 50, "", text="Product Analysis", fontSize=24, bold=True, color="#1f2937",
           background="transparent", border=False),
        _v("v2_sl_cat", "slicer", 980, 10, 280, 60, "Category", {"category": [C("Products", "Category")]}, style="dropdown"),
        _v("v2_matrix", "matrix", 20, 74, 620, 300, "Revenue by Category, Product and Year",
           {"rows": [C("Products", "Category"), C("Products", "Product")], "columns": [C("Calendar", "Year")],
            "values": [M("Total Revenue")]}),
        _v("v2_scatter", "scatter", 654, 74, 606, 300, "Revenue vs Margin (bubble = Orders)",
           {"category": [C("Products", "Product")], "x": [M("Total Revenue")], "y": [M("Profit Margin")],
            "size": [M("Orders")], "series": [C("Products", "Category")]}),
        _v("v2_tree", "treemap", 20, 388, 520, 316, "Revenue Share by Product",
           {"category": [C("Products", "Product")], "values": [M("Total Revenue")]}),
        _v("v2_table", "table", 554, 388, 706, 316, "Product Leaderboard",
           {"columns": [C("Products", "Product"), C("Products", "Category"), M("Total Revenue"), M("Profit"),
                        M("Profit Margin"), M("% of Total"), M("Product Rank")]}),
    ]
    page3 = [
        _v("v3_title", "textbox", 20, 12, 700, 50, "", text="Trends & Targets", fontSize=24, bold=True, color="#1f2937",
           background="transparent", border=False),
        _v("v3_sl", "slicer", 1000, 10, 260, 60, "Segment", {"category": [C("Customers", "Segment")]}, style="dropdown"),
        _v("v3_kpi", "kpi", 20, 74, 300, 200, "Revenue vs Last Year",
           {"category": [C("Calendar", "Year")], "values": [M("Total Revenue")], "target": [M("Revenue LY")]}),
        _v("v3_combo", "lineColumn", 334, 74, 926, 300, "Revenue and Margin by Quarter",
           {"category": [C("Calendar", "Date", "yearQuarter")], "values": [M("Total Revenue")],
            "lineValues": [M("Profit Margin")]}),
        _v("v3_area", "stackedArea", 20, 288, 300, 416, "Units by Category",
           {"category": [C("Calendar", "Year")], "series": [C("Products", "Category")], "values": [M("Units Sold")]}),
        _v("v3_water", "waterfall", 334, 388, 470, 316, "Profit Build-up by Region",
           {"category": [C("Customers", "Region")], "values": [M("Profit")]}),
        _v("v3_funnel", "funnel", 818, 388, 442, 316, "Orders by Segment",
           {"category": [C("Customers", "Segment")], "values": [M("Orders")]}),
    ]
    return {
        "version": 1,
        "title": "Sales Performance (demo)",
        "theme": "pybi",
        "pages": [
            {"id": "p1", "name": "Overview", "visuals": page1, "filters": []},
            {"id": "p2", "name": "Products", "visuals": page2, "filters": []},
            {"id": "p3", "name": "Trends", "visuals": page3, "filters": []},
        ],
        "measures": [{"name": n, "expression": e, "format": f, "table": "Sales"} for n, e, f in measures],
        "calcColumns": [
            {"table": "Sales", "name": "Revenue", "expression": "Sales[Quantity] * Sales[UnitPrice] * (1 - Sales[Discount])"},
            {"table": "Sales", "name": "Cost", "expression": "Sales[Quantity] * RELATED(Products[UnitCost])"},
        ],
        "relationships": [
            {"id": "r1", "fromTable": "Sales", "fromColumn": "ProductID", "toTable": "Products", "toColumn": "ProductID", "crossFilter": "single", "active": True},
            {"id": "r2", "fromTable": "Sales", "fromColumn": "CustomerID", "toTable": "Customers", "toColumn": "CustomerID", "crossFilter": "single", "active": True},
            {"id": "r3", "fromTable": "Sales", "fromColumn": "OrderDate", "toTable": "Calendar", "toColumn": "Date", "crossFilter": "single", "active": True},
            {"id": "r4", "fromTable": "Customers", "fromColumn": "Region", "toTable": "Targets", "toColumn": "Region", "crossFilter": "both", "active": True},
        ],
        "columnProps": {"Calendar[Month Name]": {"sortBy": "Month Number"}, "Calendar[Weekday]": {"sortBy": "Weekday Number"},
                        "Sales[UnitPrice]": {"format": {"type": "currency"}}},
        "reportFilters": [],
        "hiddenFields": [],
    }
