-- Check existing virtual groups and their colors
-- Run this to see if any virtual groups are missing colors

SELECT
  id,
  name,
  virtualGroupId,
  virtualGroupColor,
  virtualGroupPrimary,
  virtualGroupCreatedAt,
  CASE
    WHEN virtualGroupColor IS NULL THEN '❌ MISSING COLOR'
    ELSE '✅ HAS COLOR'
  END as color_status
FROM "Table"
WHERE virtualGroupId IS NOT NULL
ORDER BY virtualGroupId, virtualGroupPrimary DESC;

-- Summary: Count tables with and without colors
SELECT
  CASE
    WHEN virtualGroupColor IS NULL THEN 'Missing Color'
    ELSE 'Has Color'
  END as status,
  COUNT(*) as table_count,
  COUNT(DISTINCT virtualGroupId) as group_count
FROM "Table"
WHERE virtualGroupId IS NOT NULL
GROUP BY CASE
  WHEN virtualGroupColor IS NULL THEN 'Missing Color'
  ELSE 'Has Color'
END;
