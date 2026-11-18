// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title SongRegistry
/// @notice Approved songs, the artist payout address for each, and wallets blocked from entering
///         competitions on that song (the artist plus any known affiliates).
/// @dev Display data (title, artist name, artwork) lives offchain at `metadataURI` so the
///      contract stays small. Song ids start at 1; 0 means "no song".
contract SongRegistry {
    struct Song {
        address artist; // receives the artist share of every competition on this song
        bool active; // inactive songs cannot get new competitions
        string metadataURI; // e.g. "/songs/1.json" or "ipfs://..."
    }

    address public owner;
    uint256 public songCount;

    mapping(uint256 songId => Song) private _songs;
    mapping(uint256 songId => mapping(address wallet => bool)) public isAffiliated;

    event SongAdded(uint256 indexed songId, address indexed artist, string metadataURI);
    event SongUpdated(uint256 indexed songId, address indexed artist, bool active, string metadataURI);
    event AffiliateSet(uint256 indexed songId, address indexed wallet, bool affiliated);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    error NotOwner();
    error ZeroAddress();
    error UnknownSong();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    constructor(address initialOwner) {
        if (initialOwner == address(0)) revert ZeroAddress();
        owner = initialOwner;
        emit OwnershipTransferred(address(0), initialOwner);
    }

    // ---------------------------------------------------------------- admin

    function addSong(address artist, string calldata metadataURI)
        external
        onlyOwner
        returns (uint256 songId)
    {
        if (artist == address(0)) revert ZeroAddress();
        songId = ++songCount;
        _songs[songId] = Song({artist: artist, active: true, metadataURI: metadataURI});
        emit SongAdded(songId, artist, metadataURI);
    }

    function updateSong(uint256 songId, address artist, bool active, string calldata metadataURI)
        external
        onlyOwner
    {
        if (artist == address(0)) revert ZeroAddress();
        Song storage s = _existing(songId);
        s.artist = artist;
        s.active = active;
        s.metadataURI = metadataURI;
        emit SongUpdated(songId, artist, active, metadataURI);
    }

    function setAffiliate(uint256 songId, address wallet, bool affiliated) external onlyOwner {
        _existing(songId);
        isAffiliated[songId][wallet] = affiliated;
        emit AffiliateSet(songId, wallet, affiliated);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert ZeroAddress();
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }

    // ---------------------------------------------------------------- views

    function getSong(uint256 songId) external view returns (Song memory) {
        return _songs[songId];
    }

    function artistOf(uint256 songId) external view returns (address) {
        return _songs[songId].artist;
    }

    function isActive(uint256 songId) external view returns (bool) {
        return _songs[songId].active;
    }

    /// @notice True if `wallet` may not enter competitions on `songId`.
    function isBlocked(uint256 songId, address wallet) external view returns (bool) {
        return wallet == _songs[songId].artist || isAffiliated[songId][wallet];
    }

    // ---------------------------------------------------------------- internal

    function _existing(uint256 songId) private view returns (Song storage s) {
        s = _songs[songId];
        if (s.artist == address(0)) revert UnknownSong();
    }
}
