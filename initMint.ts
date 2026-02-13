import { getCreateAccountInstruction } from "@solana-program/system";
import {
  extension,
  getInitializeAccountInstruction,
  getInitializeMintInstruction,
  getInitializeTransferFeeConfigInstruction,
  getMintSize,
  getTokenSize,
  TOKEN_2022_PROGRAM_ADDRESS
} from "@solana-program/token-2022";
import {
  airdropFactory,
  appendTransactionMessageInstructions,
  createSolanaRpc,
  createSolanaRpcSubscriptions,
  createTransactionMessage,
  generateKeyPairSigner,
  getSignatureFromTransaction,
  lamports,
  pipe,
  sendAndConfirmTransactionFactory,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransactionMessageWithSigners
} from "@solana/kit";

async function main() {
// Create Connection, local validator in this example
const rpc = createSolanaRpc("http://localhost:8899");
const rpcSubscriptions = createSolanaRpcSubscriptions("ws://localhost:8900");

// Generate the authority for the mint (also acts as fee payer)
const authority = await generateKeyPairSigner();

// Fund authority/fee payer
await airdropFactory({ rpc, rpcSubscriptions })({
  recipientAddress: authority.address,
  lamports: lamports(5_000_000_000n), // 5 SOL
  commitment: "confirmed"
});

// Generate keypair to use as address of mint
const mint = await generateKeyPairSigner();

// And a transfer fee config extension.
const transferFees = {
  epoch: 0n,
  maximumFee: 1_000_000n,
  transferFeeBasisPoints: 150 // 1.5%
};

const transferFeeConfigExtension = extension("TransferFeeConfig", {
  transferFeeConfigAuthority: authority.address,
  withdrawWithheldAuthority: authority.address,
  withheldAmount: 0n,
  newerTransferFee: transferFees,
  // Used for transitioning configs. Starts by being the same as newerTransferFee.
  olderTransferFee: transferFees
});

// Get mint account size with transfer fee extension
const space = BigInt(getMintSize([transferFeeConfigExtension]));

// Get minimum balance for rent exemption
const rent = await rpc.getMinimumBalanceForRentExemption(space).send();

// Get latest blockhash to include in transaction
const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();

// Instruction to create new account for mint (token program)
// Invokes the system program
const createMintAccountInstruction = getCreateAccountInstruction({
  payer: authority,
  newAccount: mint,
  lamports: rent,
  space,
  programAddress: TOKEN_2022_PROGRAM_ADDRESS
});

// Instruction to initialize transfer fee config extension
const initializeTransferFeeConfigInstruction =
  getInitializeTransferFeeConfigInstruction({
    mint: mint.address,
    transferFeeConfigAuthority: authority.address,
    withdrawWithheldAuthority: authority.address,
    transferFeeBasisPoints: 100, // 1% fee
    maximumFee: 1_000_000n // Maximum fee of 1 token
  });

// Instruction to initialize mint account data
// Invokes the token22 program
const initializeMintInstruction = getInitializeMintInstruction({
  mint: mint.address,
  decimals: 6,
  mintAuthority: authority.address,
  freezeAuthority: authority.address
});

// Generate keypair to use as address of token account
const tokenAccount = await generateKeyPairSigner();

// get token account size
const tokenAccountLen = BigInt(getTokenSize([transferFeeConfigExtension]));

// Get minimum balance for rent exemption
const tokenAccountRent = await rpc
  .getMinimumBalanceForRentExemption(tokenAccountLen)
  .send();

// Instruction to create new account for the token account
// Invokes the system program
const createTokenAccountInstruction = getCreateAccountInstruction({
  payer: authority,
  newAccount: tokenAccount,
  lamports: tokenAccountRent,
  space: tokenAccountLen,
  programAddress: TOKEN_2022_PROGRAM_ADDRESS
});

// Instruction to initialize the created token account
const initializeTokenAccountInstruction = getInitializeAccountInstruction({
  account: tokenAccount.address,
  mint: mint.address,
  owner: authority.address
});

console.log("token account", tokenAccount.address); // ! debug

const instructions = [
  createMintAccountInstruction,
  initializeTransferFeeConfigInstruction,
  initializeMintInstruction,
  createTokenAccountInstruction,
  initializeTokenAccountInstruction
];

// Create transaction message
const transactionMessage = pipe(
  createTransactionMessage({ version: 0 }),
  (tx) => setTransactionMessageFeePayerSigner(authority, tx),
  (tx) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, tx),
  (tx) => appendTransactionMessageInstructions(instructions, tx)
);

// Sign transaction message with all required signers
const signedTransaction =
  await signTransactionMessageWithSigners(transactionMessage);

// Send and confirm transaction
await sendAndConfirmTransactionFactory({ rpc, rpcSubscriptions })(
  // @ts-ignore
  signedTransaction,
  { commitment: "confirmed", skipPreflight: true }
);

// Get transaction signature
const transactionSignature = getSignatureFromTransaction(signedTransaction);

console.log("Mint Address with Transfer Fees:", mint.address.toString());
console.log("Token Account:", tokenAccount.address.toString());
console.log("Transfer Fee: 1.5% (150 basis points)");
console.log("Maximum Fee: 1 token");
console.log("Withdraw Authority:", authority.address.toString());
console.log("Transaction Signature:", transactionSignature);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});