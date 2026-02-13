// Here we export some useful types and functions for interacting with the Anchor program.
import { AnchorProvider, Program } from '@coral-xyz/anchor'
import { Cluster, PublicKey } from '@solana/web3.js'
import BondingCurveIDL from '../target/idl/bonding_curve.json'
import type { BondingCurve } from '../target/types/bonding_curve'

// Re-export the generated IDL and type
export { BondingCurve, BondingCurveIDL }
// The programId is imported from the program IDL.
export const BONDING_CURVE_PROGRAM_ID = new PublicKey(BondingCurveIDL.address)

// This is a helper function to get the BondingCurve Anchor program.
export function getBondingCurveProgram(provider: AnchorProvider): Program<BondingCurve> {
  return new Program(BondingCurveIDL as BondingCurve, provider)
}

// This is a helper function to get the program ID for the BondingCurve program depending on the cluster.
export function getBondingCurveProgramId(cluster: Cluster) {
  switch (cluster) {
    case 'devnet':
    case 'testnet':
    case 'mainnet-beta':
      // For all clusters, use the program ID from the IDL
      // Make sure this matches the declare_id! in your Rust program
      return BONDING_CURVE_PROGRAM_ID
    default:
      // For localhost/custom, also use the IDL address
      return BONDING_CURVE_PROGRAM_ID
  }
}
