SELECT
  p.sku,
  p.name as product,
  p.category,
  SUM(ol.quantity) as units_sold,
  ROUND(SUM(ol.quantity)::numeric / NULLIF((MAX(o.order_date) - MIN(o.order_date))::numeric, 0), 2) as daily_velocity,
  SUM(i.quantity_on_hand) as current_stock,
  ROUND(
    SUM(i.quantity_on_hand)::numeric
    / NULLIF(SUM(ol.quantity)::numeric / NULLIF((MAX(o.order_date) - MIN(o.order_date))::numeric, 0), 0),
    1
  ) as days_of_supply
FROM products p
JOIN order_lines ol ON p.sku = ol.sku
JOIN orders o ON ol.order_id = o.id
LEFT JOIN inventory i ON p.sku = i.sku
WHERE o.order_date >= {{date_range.start}}::date AND o.order_date <= {{date_range.end}}::date
  AND ({{category}} = 'All' OR p.category = {{category}})
GROUP BY p.sku, p.name, p.category
HAVING SUM(ol.quantity) > {{min_units}}
ORDER BY daily_velocity DESC
LIMIT 50
