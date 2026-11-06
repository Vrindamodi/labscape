package com.labscape.api.core.notifications;

import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;

/** In-app notifications (bell and toasts). Push and email digests are Later. */
@Service
public class Notifications {

    public record Item(long id, String kind, String title, String body, String link, Instant createdAt, boolean read) {}

    private final JdbcClient db;

    public Notifications(JdbcClient db) {
        this.db = db;
    }

    /** Creates a notification once per dedupe key (null key = always create). */
    public void notify(UUID userId, String kind, String title, String body, String link, String dedupeKey) {
        db.sql("""
                INSERT INTO notifications (user_id, kind, title, body, link, dedupe_key)
                VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (user_id, dedupe_key) DO NOTHING
                """)
                .params(userId, kind, title, body, link, dedupeKey)
                .update();
    }

    public List<Item> list(UUID userId, int limit) {
        return db.sql("""
                SELECT id, kind, title, body, link, created_at, read_at IS NOT NULL AS read
                  FROM notifications WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT ?
                """)
                .params(userId, limit)
                .query((rs, i) -> new Item(rs.getLong("id"), rs.getString("kind"), rs.getString("title"),
                        rs.getString("body"), rs.getString("link"), rs.getTimestamp("created_at").toInstant(),
                        rs.getBoolean("read")))
                .list();
    }

    public int unread(UUID userId) {
        return db.sql("SELECT count(*) FROM notifications WHERE user_id = ? AND read_at IS NULL")
                .param(userId).query(Integer.class).single();
    }

    public void markRead(UUID userId, long id) {
        db.sql("UPDATE notifications SET read_at = now() WHERE user_id = ? AND id = ? AND read_at IS NULL")
                .params(userId, id).update();
    }

    public void markAllRead(UUID userId) {
        db.sql("UPDATE notifications SET read_at = now() WHERE user_id = ? AND read_at IS NULL").param(userId).update();
    }
}
