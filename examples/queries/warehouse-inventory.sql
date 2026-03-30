SELECT
  w.name as warehouse,
  COUNT(DISTINCT i.sku) as unique_skus,
  SUM(i.quantity_on_hand) as total_units,
  SUM(i.quantity_on_hand * p.unit_cost) as inventory_value,
  ROUND(AVG(i.days_since_last_movement)::numeric, 1) as avg_days_stale,
  SUM(CASE WHEN i.quantity_on_hand <= i.reorder_point THEN 1 ELSE 0 END) as items_below_reorder
FROM inventory i
JOIN warehouses w ON i.warehouse_id = w.warehouse_id
JOIN products p ON i.sku = p.sku
WHERE ({{warehouse}} = 'All' OR w.name = {{warehouse}})
  AND ({{category}} = 'All' OR p.category = {{category}})
GROUP BY w.name
ORDER BY inventory_value DESC
