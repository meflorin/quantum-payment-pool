/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!40101 SET NAMES utf8 */;
/*!40014 SET @OLD_FOREIGN_KEY_CHECKS=@@FOREIGN_KEY_CHECKS, FOREIGN_KEY_CHECKS=0 */;
/*!40101 SET @OLD_SQL_MODE=@@SQL_MODE, SQL_MODE='NO_AUTO_VALUE_ON_ZERO' */;
/*!40111 SET @OLD_SQL_NOTES=@@SQL_NOTES, SQL_NOTES=0 */;

CREATE DATABASE IF NOT EXISTS `quantum_pp`;
USE `quantum_pp`;

DROP TABLE IF EXISTS `session_tx`;

CREATE TABLE `session_tx` (
  `session_id` varchar(255) NOT NULL,
  `from_address` varchar(255) NOT NULL,
  `to_address` varchar(255) NOT NULL DEFAULT '',
  `value` bigint(20) NOT NULL DEFAULT 0,
  `signature` varchar(255) NOT NULL DEFAULT '',
  `commited` int(11) NOT NULL DEFAULT 0,
  `tx_hash` varchar(255) NOT NULL DEFAULT '',
  `pending` int(11) NOT NULL DEFAULT 0,
  `receipt` text NOT NULL,
  `created_at` datetime NOT NULL,
  `updated_at` datetime NOT NULL,
  PRIMARY KEY (`session_id`,`from_address`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

/*!40111 SET SQL_NOTES=@OLD_SQL_NOTES */;
/*!40101 SET SQL_MODE=@OLD_SQL_MODE */;
/*!40014 SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS */;
/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!40101 SET NAMES utf8 */;
/*!40014 SET @OLD_FOREIGN_KEY_CHECKS=@@FOREIGN_KEY_CHECKS, FOREIGN_KEY_CHECKS=0 */;
/*!40101 SET @OLD_SQL_MODE=@@SQL_MODE, SQL_MODE='NO_AUTO_VALUE_ON_ZERO' */;
/*!40111 SET @OLD_SQL_NOTES=@@SQL_NOTES, SQL_NOTES=0 */;

CREATE DATABASE IF NOT EXISTS `quantum_pp`;
USE `quantum_pp`;

DROP TABLE IF EXISTS `session_tx`;

CREATE TABLE `session_tx` (
  `session_id` varchar(255) NOT NULL,
  `from_address` varchar(255) NOT NULL,
  `to_address` varchar(255) NOT NULL DEFAULT '',
  `value` bigint(20) NOT NULL DEFAULT 0,
  `signature` varchar(255) NOT NULL DEFAULT '',
  `commited` int(11) NOT NULL DEFAULT 0,
  `tx_hash` varchar(255) NOT NULL DEFAULT '',
  `pending` int(11) NOT NULL DEFAULT 0,
  `receipt` text NOT NULL,
  `created_at` datetime NOT NULL,
  `updated_at` datetime NOT NULL,
  PRIMARY KEY (`session_id`,`from_address`)
) ENGINE=InnoDB DEFAULT CHARSET=latin1;

/*!40111 SET SQL_NOTES=@OLD_SQL_NOTES */;
/*!40101 SET SQL_MODE=@OLD_SQL_MODE */;
/*!40014 SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS */;
/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;

DROP TABLE IF EXISTS `withdraw_tx`;

CREATE TABLE `withdraw_tx` (
  `to_address` varchar(255) NOT NULL,
  `signature` varchar(255) NOT NULL,
  `tx_hash` varchar(255) DEFAULT NULL,
  `receipt` text,
  `commited` int(11) DEFAULT '0',
  `pending` int(11) DEFAULT '0',
  `cooldown_expire` datetime NOT NULL,
  `by_user` int(11) DEFAULT '0',
  `retries` int(11) DEFAULT '0',
  `created_at` datetime NOT NULL,
  `updated_at` datetime NOT NULL,
  PRIMARY KEY (`to_address`)
) ENGINE=InnoDB DEFAULT CHARSET=latin1;

USE `quantum_pp`;
DELIMITER $$
DROP TRIGGER IF EXISTS session_tx_after_insert $$
CREATE TRIGGER session_tx_after_insert
AFTER INSERT
ON session_tx
FOR EACH ROW
BEGIN
	DECLARE userid INT;
	DECLARE kp_data_start DATETIME;
	
	SET userid = (SELECT id from `frizbee`.`user` where eth_address = NEW.from_address LIMIT 1);
	SET kp_data_start = (SELECT data_start from `frizbee`.`conference_session_user` where is_kp = 1 AND  conference_session_id = NEW.session_id LIMIT 1);
	
	insert into `frizbee`.`conference_session_user`
		(
			conference_session_id, 
			user_id, 
			is_kp, 
			data_start
		) 
	values
		(
			NEW.session_id, 
			userid, 
			0, 
			NEW.created_at
		);
		
	IF (kp_data_start IS NULL || NEW.created_at < STR_TO_DATE(kp_data_start, '%Y-%m-%d %H:%i:%s') ) THEN
		
		UPDATE `frizbee`.`conference_session_user`
			SET
				data_start = NEW.created_at
		WHERE is_kp = 1 AND conference_session_id = NEW.session_id;
	END IF;	
END$$

DELIMITER //
DROP TRIGGER IF EXISTS session_tx_after_update //
CREATE TRIGGER session_tx_after_update
AFTER UPDATE
ON session_tx
FOR EACH ROW
BEGIN
		DECLARE userid INT;
		DECLARE session_duration INT;
		DECLARE kp_data_end DATETIME;
		DECLARE kp_cost_eth BIGINT;
		DECLARE session_eth_usd FLOAT;

	IF (NEW.commited > 0 && NEW.pending < 1) THEN
	
		SET userid = (SELECT id from `frizbee`.`user` where eth_address = NEW.from_address LIMIT 1);
		SET session_duration = (SELECT TIMESTAMPDIFF(SECOND, NEW.created_at, OLD.updated_at));
		SET kp_data_end = (SELECT data_end from `frizbee`.`conference_session_user` where is_kp = 1 AND  conference_session_id = NEW.session_id LIMIT 1);
		SET kp_cost_eth = (SELECT cost_eth from `frizbee`.`conference_session_user` where is_kp = 1 AND  conference_session_id = NEW.session_id LIMIT 1);
		SET session_eth_usd = (SELECT eth_usd from `frizbee`.`conference_session` WHERE ref = NEW.session_id LIMIT 1);
		
		UPDATE `frizbee`.`conference_session_user`
			SET
				data_end = OLD.updated_at,
				duration = session_duration,
				cost_eth = NEW.value,
				cost_usd = ROUND((NEW.value / POWER(10,18)) * session_eth_usd, 4)
		WHERE user_id = userid AND conference_session_id = NEW.session_id;
		
		UPDATE `frizbee`.`conference_session_user`
			SET
				cost_eth = ROUND(cost_eth + NEW.value * 0.95),
				cost_usd = cost_usd + ROUND((NEW.value * 0.95 / POWER(10,18)) * session_eth_usd, 4)
		WHERE is_kp = 1 AND conference_session_id = NEW.session_id;
		
		IF (kp_data_end IS NULL || OLD.updated_at > STR_TO_DATE(kp_data_end, '%Y-%m-%d %H:%i:%s') ) THEN
		
			UPDATE `frizbee`.`conference_session_user`
				SET
					data_end = OLD.updated_at,
					duration = session_duration
			WHERE is_kp = 1 AND conference_session_id = NEW.session_id;			
			
		END IF;
		
	END IF;
END//