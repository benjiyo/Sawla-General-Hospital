-- Migration: 001_create_hospital_news.sql
-- Creates `hospital_news` table with recommended settings

CREATE TABLE IF NOT EXISTS `hospital_news` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `title` VARCHAR(255) NOT NULL,
  `slug` VARCHAR(255) NOT NULL,
  `summary` TEXT,
  `content` LONGTEXT,
  `category` VARCHAR(100),
  `author` VARCHAR(150),
  `publish_date` DATE,
  `featured_image` VARCHAR(255),
  `meta_title` VARCHAR(255),
  `meta_description` TEXT,
  `meta_keywords` TEXT,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `status` ENUM('draft','published') NOT NULL DEFAULT 'draft',
  PRIMARY KEY (`id`),
  UNIQUE KEY `unq_slug` (`slug`),
  FULLTEXT KEY `ft_title_summary_content` (`title`, `summary`, `content`),
  KEY `idx_status_publish_date` (`status`, `publish_date`),
  KEY `idx_category` (`category`),
  KEY `idx_author` (`author`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
