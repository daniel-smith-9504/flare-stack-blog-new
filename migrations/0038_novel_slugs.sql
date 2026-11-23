-- Books get a readable URL, and the shelf tag feature goes away.
ALTER TABLE novels ADD COLUMN slug text;

UPDATE novels
SET slug = trim(
  lower(
    replace(
      replace(
        replace(
          replace(
            replace(
              replace(trim(title), ' ', '-'),
            '　', '-'),
          '/', '-'),
        '#', '-'),
      '?', '-'),
    '%', '-')
  )
);

UPDATE novels
SET slug = 'novel-' || id
WHERE slug IS NULL OR slug = '';

-- Distinct books may share a title; only the first keeps the plain slug.
UPDATE novels
SET slug = slug || '-' || id
WHERE id IN (
  SELECT id
  FROM (
    SELECT id, row_number() OVER (PARTITION BY slug ORDER BY id) AS rank
    FROM novels
  )
  WHERE rank > 1
);

CREATE UNIQUE INDEX novels_slug_idx ON novels (slug);

DROP TABLE IF EXISTS novel_tag_links;
DROP TABLE IF EXISTS novel_tags;
