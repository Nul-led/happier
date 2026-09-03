use std::fmt;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum IrohFailureReason {
    UnsupportedAlpn,
    InvalidPreamble,
    InvalidDescriptor,
    EndpointConfigConflict,
    Io,
    Cancelled,
    ResourceLimit,
    LoopbackBindFailed,
    TransportClosed,
    EndpointIdentityMismatch,
    TransportTimeout,
}

#[derive(Debug)]
pub enum IrohError {
    UnsupportedAlpn,
    InvalidPreamble,
    /// Descriptor-derived metadata failed strict validation (grammar, bounds,
    /// credentials, or scheme). Never downgraded to a fallback path.
    InvalidDescriptor,
    /// The same endpoint identity key was requested with a different relay or
    /// cap configuration. Failing clearly prevents a silent second owner.
    EndpointConfigConflict,
    Io(std::io::Error),
    Cancelled,
    ResourceLimit,
    LoopbackBindFailed,
    TransportClosed,
    /// The authenticated transport identity of a dialed connection does not
    /// match the requested endpoint descriptor. Raised by the one outgoing
    /// identity guard shared by the Home and machine tunnels
    /// (`endpoint::verified_remote_endpoint_id`) and surfaced under the same
    /// "endpoint-identity-mismatch" classification the machine acceptor path
    /// already reports, so a start-path mismatch fails closed with one code.
    EndpointIdentityMismatch,
    TransportTimeout,
}
impl PartialEq for IrohError {
    fn eq(&self, other: &Self) -> bool {
        self.reason() == other.reason()
    }
}
impl Eq for IrohError {}

impl IrohError {
    pub const fn reason(&self) -> IrohFailureReason {
        match self {
            Self::UnsupportedAlpn => IrohFailureReason::UnsupportedAlpn,
            Self::InvalidPreamble => IrohFailureReason::InvalidPreamble,
            Self::InvalidDescriptor => IrohFailureReason::InvalidDescriptor,
            Self::EndpointConfigConflict => IrohFailureReason::EndpointConfigConflict,
            Self::Io(_) => IrohFailureReason::Io,
            Self::Cancelled => IrohFailureReason::Cancelled,
            Self::ResourceLimit => IrohFailureReason::ResourceLimit,
            Self::LoopbackBindFailed => IrohFailureReason::LoopbackBindFailed,
            Self::TransportClosed => IrohFailureReason::TransportClosed,
            Self::EndpointIdentityMismatch => IrohFailureReason::EndpointIdentityMismatch,
            Self::TransportTimeout => IrohFailureReason::TransportTimeout,
        }
    }
}
impl fmt::Display for IrohError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{:?}", self)
    }
}
impl std::error::Error for IrohError {}
impl From<std::io::Error> for IrohError {
    fn from(e: std::io::Error) -> Self {
        Self::Io(e)
    }
}
pub type Result<T> = std::result::Result<T, IrohError>;
