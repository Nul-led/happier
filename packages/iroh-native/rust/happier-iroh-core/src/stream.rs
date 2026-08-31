use tokio::io::{AsyncRead, AsyncWrite, AsyncWriteExt};

/// Pumps two split async streams until both directions finish. EOF in either
/// direction immediately shuts down that direction's destination write half;
/// it never waits for the opposite direction to drain first.
///
/// Task cancellation is deliberately owned by the caller's `JoinSet`. Dropping
/// the pump future drops all four borrowed halves, so no child task or retry
/// lifecycle exists below the Home/machine tunnel owners.
pub(crate) async fn pump_bidirectional<LR, LW, RR, RW>(
    left_read: &mut LR,
    left_write: &mut LW,
    right_read: &mut RR,
    right_write: &mut RW,
) where
    LR: AsyncRead + Unpin,
    LW: AsyncWrite + Unpin,
    RR: AsyncRead + Unpin,
    RW: AsyncWrite + Unpin,
{
    async fn copy_and_shutdown<R, W>(reader: &mut R, writer: &mut W)
    where
        R: AsyncRead + Unpin,
        W: AsyncWrite + Unpin,
    {
        let _ = tokio::io::copy(reader, writer).await;
        let _ = writer.shutdown().await;
    }

    tokio::join!(
        copy_and_shutdown(left_read, right_write),
        copy_and_shutdown(right_read, left_write),
    );
}
