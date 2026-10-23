// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice ERC-165 interface detection standard.
interface IERC165 {
    function supportsInterface(bytes4 interfaceId) external view returns (bool);
}

/// @title IReceiver - receives keystone reports
/// @notice Implementations must support the IReceiver interface through ERC165.
interface IReceiver is IERC165 {
    /// @notice Handles incoming keystone reports.
    /// @dev If this function call reverts, it can be retried with a higher gas
    /// limit. The receiver is responsible for discarding stale reports.
    /// @param metadata Report's metadata.
    /// @param report Workflow report.
    function onReport(bytes calldata metadata, bytes calldata report) external;
}

/// @title ReceiverTemplate
/// @notice Minimal CRE receiver that permanently trusts one constructor-supplied forwarder.
abstract contract ReceiverTemplate is IReceiver {
    error InvalidForwarderAddress();
    error InvalidSender(address sender, address expected);

    address public immutable forwarder;

    constructor(address forwarderAddress) {
        if (forwarderAddress == address(0)) revert InvalidForwarderAddress();
        forwarder = forwarderAddress;
    }

    /// @inheritdoc IReceiver
    function onReport(bytes calldata metadata, bytes calldata report) external override {
        if (msg.sender != forwarder) revert InvalidSender(msg.sender, forwarder);
        _onReport(metadata, report);
    }

    /// @notice Processes an authenticated CRE report.
    function _onReport(bytes calldata metadata, bytes calldata report) internal virtual;

    /// @inheritdoc IERC165
    function supportsInterface(bytes4 interfaceId) public pure virtual override returns (bool) {
        return interfaceId == type(IReceiver).interfaceId || interfaceId == type(IERC165).interfaceId;
    }
}

/// @title EchoLedger
/// @notice Stores CRE-attested practice trading decisions, settlements, and KOL trust scores.
contract EchoLedger is ReceiverTemplate {
    enum ReportType {
        OPEN,
        SETTLE,
        TRUST_UPDATE
    }

    enum Side {
        LONG,
        SHORT,
        NONE
    }

    enum Attestation {
        APPROVE,
        CONSTRAIN,
        REJECT
    }

    struct OpenReport {
        bytes32 positionId;
        string token;
        Side side;
        uint256 sizeBps;
        uint256 entryPriceE8;
        bytes32 cardHash;
        Attestation attestation;
        uint256 reasonCode;
        bytes32[] kolIds;
        bool[] echoFlags;
    }

    struct SettleReport {
        bytes32 positionId;
        uint256 exitPriceE8;
        int256 pnlBps;
        uint256 settledAt;
    }

    struct TrustUpdateReport {
        bytes32 positionId;
        bytes32[] kolIds;
        uint256[] scores;
        uint256[] trades;
    }

    struct Position {
        bool exists;
        bool settled;
        string token;
        Side side;
        uint256 sizeBps;
        uint256 entryPriceE8;
        bytes32 cardHash;
        Attestation attestation;
        uint256 reasonCode;
        uint256 exitPriceE8;
        int256 pnlBps;
        uint256 settledAt;
    }

    struct KolTrust {
        uint256 score;
        uint256 trades;
    }

    error EmptyReport();
    error InvalidReportType(uint256 reportType);
    error DuplicatePosition(bytes32 positionId);
    error PositionNotFound(bytes32 positionId);
    error PositionNotOpen(bytes32 positionId);
    error InvalidSizeBps(uint256 sizeBps);
    error InvalidTrustScore(uint256 score);
    error SourceLengthMismatch(uint256 kolIdsLength, uint256 echoFlagsLength);
    error MissingSources();
    error TooManySources(uint256 count);
    error DuplicateKolId(bytes32 kolId);
    error KolNotInPosition(bytes32 positionId, bytes32 kolId);
    error TrustAlreadyUpdated(bytes32 positionId, bytes32 kolId);
    error TrustLengthMismatch(uint256 kolIdsLength, uint256 scoresLength, uint256 tradesLength);

    event PositionOpened(bytes32 indexed id, string token, bytes32 indexed cardHash);
    event PositionSettled(bytes32 indexed id, int256 pnlBps);
    event TrustUpdated(bytes32 indexed kolId, uint256 score);

    mapping(bytes32 positionId => Position position) private s_positions;
    mapping(bytes32 => bytes32[]) private s_positionKolIds;
    mapping(bytes32 => bool[]) private s_positionEchoFlags;
    mapping(bytes32 => mapping(bytes32 => bool)) private s_trustUpdated;
    mapping(bytes32 kolId => KolTrust trust) private s_kolTrust;
    bytes32[] private s_openPositionIds;
    mapping(bytes32 positionId => uint256 indexPlusOne) private s_openPositionIndex;

    constructor(address forwarderAddress) ReceiverTemplate(forwarderAddress) {}

    /// @notice Returns a stored position or rejected decision.
    function getPosition(bytes32 id) external view returns (Position memory) {
        return s_positions[id];
    }

    /// @notice Returns the KOL IDs and echo flags committed with an OPEN report.
    function getPositionSources(bytes32 id) external view returns (bytes32[] memory kolIds, bool[] memory echoFlags) {
        if (!s_positions[id].exists) revert PositionNotFound(id);
        return (s_positionKolIds[id], s_positionEchoFlags[id]);
    }

    /// @notice Returns IDs for active, unsettled practice positions.
    function openPositionIds() external view returns (bytes32[] memory) {
        return s_openPositionIds;
    }

    /// @notice Returns the latest trust score and trade count for a KOL.
    function kolTrust(bytes32 kolId) external view returns (KolTrust memory) {
        return s_kolTrust[kolId];
    }

    /// @dev Payload format is abi.encode(ReportType, corresponding report struct).
    function _onReport(bytes calldata, bytes calldata report) internal override {
        if (report.length < 32) revert EmptyReport();

        uint256 rawReportType = abi.decode(report, (uint256));
        if (rawReportType > uint256(ReportType.TRUST_UPDATE)) revert InvalidReportType(rawReportType);

        ReportType reportType = ReportType(rawReportType);
        if (reportType == ReportType.OPEN) {
            (, OpenReport memory openReport) = abi.decode(report, (ReportType, OpenReport));
            _open(openReport);
        } else if (reportType == ReportType.SETTLE) {
            (, SettleReport memory settleReport) = abi.decode(report, (ReportType, SettleReport));
            _settle(settleReport);
        } else {
            (, TrustUpdateReport memory trustReport) = abi.decode(report, (ReportType, TrustUpdateReport));
            _updateTrust(trustReport);
        }
    }

    function _open(OpenReport memory report) private {
        if (s_positions[report.positionId].exists) revert DuplicatePosition(report.positionId);
        if (report.sizeBps > 10_000) revert InvalidSizeBps(report.sizeBps);
        if (report.kolIds.length != report.echoFlags.length) {
            revert SourceLengthMismatch(report.kolIds.length, report.echoFlags.length);
        }
        if (report.kolIds.length > 20) revert TooManySources(report.kolIds.length);
        if (report.attestation != Attestation.REJECT && report.side != Side.NONE && report.kolIds.length == 0) {
            revert MissingSources();
        }

        for (uint256 i = 0; i < report.kolIds.length; ++i) {
            for (uint256 j = 0; j < i; ++j) {
                if (report.kolIds[i] == report.kolIds[j]) revert DuplicateKolId(report.kolIds[i]);
            }
            s_positionKolIds[report.positionId].push(report.kolIds[i]);
            s_positionEchoFlags[report.positionId].push(report.echoFlags[i]);
        }

        s_positions[report.positionId] = Position({
            exists: true,
            settled: false,
            token: report.token,
            side: report.side,
            sizeBps: report.sizeBps,
            entryPriceE8: report.entryPriceE8,
            cardHash: report.cardHash,
            attestation: report.attestation,
            reasonCode: report.reasonCode,
            exitPriceE8: 0,
            pnlBps: 0,
            settledAt: 0
        });

        if (report.attestation != Attestation.REJECT && report.side != Side.NONE) {
            s_openPositionIds.push(report.positionId);
            s_openPositionIndex[report.positionId] = s_openPositionIds.length;
        }

        emit PositionOpened(report.positionId, report.token, report.cardHash);
    }

    function _settle(SettleReport memory report) private {
        Position storage position = s_positions[report.positionId];
        if (!position.exists) revert PositionNotFound(report.positionId);

        uint256 indexPlusOne = s_openPositionIndex[report.positionId];
        if (position.settled || indexPlusOne == 0) revert PositionNotOpen(report.positionId);

        position.settled = true;
        position.exitPriceE8 = report.exitPriceE8;
        position.pnlBps = report.pnlBps;
        position.settledAt = report.settledAt;

        uint256 index = indexPlusOne - 1;
        uint256 lastIndex = s_openPositionIds.length - 1;
        if (index != lastIndex) {
            bytes32 movedId = s_openPositionIds[lastIndex];
            s_openPositionIds[index] = movedId;
            s_openPositionIndex[movedId] = index + 1;
        }
        s_openPositionIds.pop();
        delete s_openPositionIndex[report.positionId];

        emit PositionSettled(report.positionId, report.pnlBps);
    }

    function _updateTrust(TrustUpdateReport memory report) private {
        Position storage position = s_positions[report.positionId];
        if (!position.exists) revert PositionNotFound(report.positionId);
        if (!position.settled) revert PositionNotOpen(report.positionId);
        if (report.kolIds.length != report.scores.length || report.kolIds.length != report.trades.length) {
            revert TrustLengthMismatch(report.kolIds.length, report.scores.length, report.trades.length);
        }

        bytes32[] storage positionKolIds = s_positionKolIds[report.positionId];
        for (uint256 i = 0; i < report.kolIds.length; ++i) {
            if (report.scores[i] > 10_000) revert InvalidTrustScore(report.scores[i]);
            if (s_trustUpdated[report.positionId][report.kolIds[i]]) {
                revert TrustAlreadyUpdated(report.positionId, report.kolIds[i]);
            }
            for (uint256 j = 0; j < i; ++j) {
                if (report.kolIds[i] == report.kolIds[j]) revert DuplicateKolId(report.kolIds[i]);
            }

            bool found;
            for (uint256 j = 0; j < positionKolIds.length; ++j) {
                if (positionKolIds[j] == report.kolIds[i]) {
                    found = true;
                    break;
                }
            }
            if (!found) revert KolNotInPosition(report.positionId, report.kolIds[i]);
        }

        for (uint256 i = 0; i < report.kolIds.length; ++i) {
            s_trustUpdated[report.positionId][report.kolIds[i]] = true;
            s_kolTrust[report.kolIds[i]] = KolTrust({score: report.scores[i], trades: report.trades[i]});
            emit TrustUpdated(report.kolIds[i], report.scores[i]);
        }
    }
}
