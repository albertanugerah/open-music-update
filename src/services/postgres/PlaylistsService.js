const { Pool } = require('pg');
const { nanoid } = require('nanoid');
const InvariantError = require('../../exceptions/InvariantError');
const NotFoundError = require('../../exceptions/NotFoundError');
const AuthorizationError = require('../../exceptions/AuthorizationError');

class PlaylistsService {
  constructor(collaborationService) {
    this._pool = new Pool();
    this._collaborationService = collaborationService;
  }

  async addPlaylist({ name, owner }) {
    const id = `playlist-${nanoid(16)}`;

    const query = {
      text: 'INSERT INTO playlists VALUES($1, $2, $3) RETURNING id',
      values: [id, name, owner],
    };

    const result = await this._pool.query(query);

    if (!result.rows[0].id) {
      throw new InvariantError('Playlist gagal ditambahkan');
    }

    return result.rows[0].id;
  }

  async getPlaylists(user) {
    const query = {
      text: `SELECT playlists.id, playlists.name, users.username FROM playlists 
      LEFT JOIN users ON users.id = playlists.owner
      LEFT JOIN collaborations ON playlists.id = collaborations.playlist_id  
      WHERE playlists.owner = $1 OR collaborations.user_id = $1;`,
      values: [user],
    };

    const result = await this._pool.query(query);

    return result.rows;
  }

  async deletePlaylistById(id) {
    const query = {
      text: 'DELETE FROM playlists WHERE id = $1 RETURNING id',
      values: [id],
    };

    const result = await this._pool.query(query);

    if (!result.rows.length) {
      throw new NotFoundError('Playlist gagal dihapus. Id tidak ditemukan');
    }
  }

  async addSongToPlaylist(playlistId, songId) {
    const song = {
      text: 'SELECT * FROM songs WHERE id = $1',
      values: [songId],
    };
    const getSong = await this._pool.query(song);

    if (!getSong.rows.length) {
      throw new NotFoundError('Lagu gagal ditambahkan');
    }
    const query = {
      text: 'INSERT INTO playlistsongs (playlist_id, song_id) VALUES($1, $2) RETURNING id',
      values: [playlistId, songId],
    };

    const result = await this._pool.query(query);

    if (!result.rows[0].id) {
      throw new InvariantError('Lagu gagal ditambahkan ke playlist');
    }
  }

  async getSongsFromPlaylist(playlistId) {
    const playlist = {
      text: `SELECT playlists.id, playlists.name, users.username 
            FROM playlistsongs 
            INNER JOIN playlists ON playlistsongs.playlist_id = playlists.id 
            INNER JOIN users ON playlists.owner = users.id WHERE playlist_id = $1`,
      values: [playlistId],
    };

    const songs = {
      text: 'SELECT songs.id, songs.title, songs.performer FROM playlistsongs INNER JOIN songs ON playlistsongs.song_id = songs.id WHERE playlist_id = $1',
      values: [playlistId],
    };

    const resultPlaylist = await this._pool.query(playlist);
    const resultSongs = await this._pool.query(songs);

    if (!resultPlaylist.rowCount) {
      throw new NotFoundError('Playlist tidak ditemukan');
    }

    return {
      id: resultPlaylist.rows[0].id,
      name: resultPlaylist.rows[0].name,
      username: resultPlaylist.rows[0].username,
      songs: resultSongs.rows,
    };
  }

  async deleteSongFromPlaylist(playlistId, songId) {
    const query = {
      text: 'DELETE FROM playlistsongs WHERE playlist_id = $1 AND song_id = $2 RETURNING id',
      values: [playlistId, songId],
    };

    const result = await this._pool.query(query);

    if (!result.rows.length) {
      throw new InvariantError('Lagu gagal dihapus');
    }
  }

  async verifyPlaylistOwner(id, owner) {
    const query = {
      text: 'SELECT * FROM playlists WHERE id = $1',
      values: [id],
    };
    const result = await this._pool.query(query);

    if (!result.rows.length) {
      throw new NotFoundError('Playlist tidak ditemukan');
    }
    const playlist = result.rows[0];
    if (playlist.owner !== owner) {
      throw new AuthorizationError('Anda tidak berhak mengakses resource ini');
    }
  }

  async verifyPlaylistAccess(playlistId, userId) {
    try {
      await this.verifyPlaylistOwner(playlistId, userId);
    } catch (error) {
      if (error instanceof NotFoundError) {
        throw error;
      }
      try {
        await this._collaborationService.verifyCollaborator(playlistId, userId);
      } catch {
        throw error;
      }
    }
  }

  async getUsersByUsername(username) {
    const query = {
      text: 'SELECT id, username, fullname FROM users WHERE username LIKE $1',
      values: [`%${username}%`],
    };
    const result = await this._pool.query(query);
    return result.rows;
  }

  async addActionPlaylistActivity(playlistId, songId, userId, action = '') {
    console.log(playlistId, songId, userId, action);
    const querySong = {
      text: 'SELECT title FROM songs WHERE id = $1',
      values: [songId],
    };
    const queryUser = {
      text: 'SELECT username FROM users WHERE id = $1',
      values: [userId],
    };

    const resultSong = await this._pool.query(querySong);
    const resultUser = await this._pool.query(queryUser);
    if (!resultSong.rowCount) {
      throw new NotFoundError('lagu tidak ada');
    }

    if (!resultUser.rowCount) {
      throw new NotFoundError('lagu tidak ada');
    }
    const { title } = resultSong.rows[0];
    const { username } = resultUser.rows[0];

    const id = `activity-${nanoid(16)}`;
    const time = new Date().toISOString();
    const act = (action === 'add') ? 'add' : 'delete';

    const query = {
      text: 'INSERT INTO playlist_songs_activities (id, playlist_id, song_id, user_id, action, time) VALUES ($1, $2, $3, $4, $5, $6)',
      values: [id, playlistId, title, username, `${act}`, time],
    };

    const result = await this._pool.query(query);
    console.log(query.values, result);
    if (!result.rowCount) {
      throw new InvariantError('activitas gagal ditambahkan');
    }
  }

  async getPlaylistActivities(playlistId) {
    const query = {
      text: 'SELECT * FROM playlist_songs_activities WHERE playlist_id = $1',
      values: [playlistId],
    };

    const result = await this._pool.query(query);

    const remap = result.rows.map((item) => ({
      username: item.user_id,
      title: item.song_id,
      action: item.action,
      time: item.time,
    }));

    return {
      playlistId,
      activities: remap,
    };
  }
}

module.exports = PlaylistsService;