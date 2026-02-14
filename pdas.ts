import { PublicKey } from "@solana/web3.js";
import * as anchor from '@coral-xyz/anchor';
import { TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import { address, appendTransactionMessageInstructions, createKeyPairSignerFromBytes, createSolanaRpc, createSolanaRpcSubscriptions, createTransactionMessage, generateKeyPair, getSignatureFromTransaction, pipe, sendAndConfirmTransactionFactory, setTransactionMessageFeePayerSigner, setTransactionMessageLifetimeUsingBlockhash, signTransactionMessageWithSigners } from "@solana/kit";
import * as fs from "fs";
import { getMintToInstruction } from "@solana-program/token-2022";

interface CpmmConfig {
  id: string;
  index: number;
  tradeFeeRate: number;
  protocolFeeRate: number;
  fundFeeRate: number;
  createPoolFee: string;
  creatorFeeRate?: number;
}

async function main() {
  console.log('Fetching CPMM configs from Raydium API (devnet)...\n');
  
  try {
    // Fetch from devnet API
    const response = await fetch('https://api-v3-devnet.raydium.io/main/cpmm-config');
    const data: any = await response.json();
    
    console.log('Raw API response:', JSON.stringify(data, null, 2));
    
    // Check if data is an array or if configs are nested
    const configs = Array.isArray(data) ? data : (data.data || data.configs || []);
    
    console.log(`\nFound ${configs.length} CPMM configs on devnet:\n`);
    
    configs.forEach((config: CpmmConfig, index: number) => {
      console.log(`Config ${index}:`);
      console.log(`  ID: ${config.id}`);
      console.log(`  Index: ${config.index}`);
      console.log(`  Trade Fee Rate: ${config.tradeFeeRate}`);
      console.log(`  Protocol Fee Rate: ${config.protocolFeeRate}`);
      console.log(`  Fund Fee Rate: ${config.fundFeeRate}`);
      console.log(`  Create Pool Fee: ${config.createPoolFee}`);
      console.log(`  Creator Fee Rate: ${config.creatorFeeRate || 'N/A'}`);
      console.log();
    });
    
    console.log('\nUse one of these config IDs for your ammConfig parameter');
    console.log('\nNote: The address you\'re currently using (5MxLgy9oPdTC3YgkiePHqr3EoCRD9uLVYRQS2ANAs7wy)');
    console.log('appears to be a mainnet config. Make sure to use a devnet config from the list above.');
    
  } catch (error) {
    console.error('Error fetching CPMM configs:', error);
  }
}
async function getTokenAccounts() {
  const connection = new anchor.web3.Connection('https://devnet.helius-rpc.com/?api-key=d25ddc06-ce2f-4e6c-9ae2-d2f630f3f716', 'confirmed');
  const publicKey = new PublicKey("7PS1wqgiqekZ6R6XFCmGKQZB6faaWtQ37vkccWDePEiq"); // Replace with your public key

  const tokenAccounts = await connection.getTokenAccountsByOwner(publicKey, {
    programId: TOKEN_2022_PROGRAM_ID,
  });
  console.log(tokenAccounts)
}

async function getInitAccountsAndMint() {
  const connection = new anchor.web3.Connection('https://mainnet.helius-rpc.com/?api-key=d25ddc06-ce2f-4e6c-9ae2-d2f630f3f716', 'confirmed');
  const rpc = createSolanaRpc("https://mainnet.helius-rpc.com/?api-key=d25ddc06-ce2f-4e6c-9ae2-d2f630f3f716");
  const rpcSubscriptions = createSolanaRpcSubscriptions("wss://mainnet.helius-rpc.com/?api-key=d25ddc06-ce2f-4e6c-9ae2-d2f630f3f716");
  const programID = new PublicKey("HakK1rCYDRTKPbxRD3yNRxHtuMfo6ipu947Lw5F6RJmJ"); // Replace with your public key
  const mint = new PublicKey("B1nWAFv3s8BkTS2FjwDPvA3GcgSKWEQivQ4jk88JApUY"); // Replace with your mint address

  const keypairBytes = new Uint8Array(JSON.parse(fs.readFileSync("/home/cotko/.config/solana/id.json", "utf-8")));
  const authority = await createKeyPairSignerFromBytes(keypairBytes);

  const [dataAccount] = PublicKey.findProgramAddressSync(
    [Buffer.from("data")],
    programID
  );
  console.log("Data Account:", dataAccount.toBase58());
  const [curveTokenAuthority] = PublicKey.findProgramAddressSync(
    [Buffer.from("curve_tokens_authority")],
    programID
  );
  console.log("Curve Token Authority:", curveTokenAuthority.toBase58());

  const [devAccount1] = PublicKey.findProgramAddressSync(
    [Buffer.from("dev_account"),
      new PublicKey("7Y9B1UwX4Rxzb3agv9fB3JMAR1a6pKJP1EYyUcXC416x").toBuffer()
    ],
    programID
  );
  console.log("Dev Account 1:", devAccount1.toBase58());

  const [devAccount2] = PublicKey.findProgramAddressSync(
    [Buffer.from("dev_account"),
      new PublicKey("3mfXu7qfUxcv3BWvy1f7dWFRT4t2UiNew62udN5wggNH").toBuffer()
    ],
    programID
  );
  console.log("Dev Account 2:", devAccount2.toBase58());

  const [devPool1] = PublicKey.findProgramAddressSync(
    [Buffer.from("dev_pool"), devAccount1.toBuffer()],
    programID
  );
  console.log("Dev Pool 1:", devPool1.toBase58());
  const mintInst1 = getMintToInstruction({
    mint: address(mint.toString()),
    token: address(devPool1.toString()),
    mintAuthority: authority,
    amount: 100_000_000n * (10n ** 9n)
  });

  const [devPool2] = PublicKey.findProgramAddressSync(
    [Buffer.from("dev_pool"), devAccount2.toBuffer()],
    programID
  );
  console.log("Dev Pool 2:", devPool2.toBase58());
  const mintInst2 = getMintToInstruction({
    mint: address(mint.toString()),
    token: address(devPool2.toString()),
    mintAuthority: authority,
    amount: 100_000_000n * (10n ** 9n)
  });

  const [giveawayPool] = PublicKey.findProgramAddressSync(
    [Buffer.from("giveaway_pool"), dataAccount.toBuffer()],
    programID
  );
  console.log("Giveaway Pool:", giveawayPool.toBase58());
  const mintInst3 = getMintToInstruction({
    mint: address(mint.toString()),
    token: address(giveawayPool.toString()),
    mintAuthority: authority,
    amount: 200_000_000n * (10n ** 9n)
  });

  const [poolTokenTreasury] = PublicKey.findProgramAddressSync(
    [Buffer.from("pool_token_treasury"), dataAccount.toBuffer()],
    programID
  );
  console.log("Pool Token Treasury:", poolTokenTreasury.toBase58());
  const mintInst4 = getMintToInstruction({
    mint: address(mint.toString()),
    token: address(poolTokenTreasury.toString()),
    mintAuthority: authority,
    amount: 200_000_000n * (10n ** 9n)
  });

  const [curveTokenTreasury] = PublicKey.findProgramAddressSync(
    [Buffer.from("curve_token_treasury"), dataAccount.toBuffer()],
    programID
  );
  console.log("Curve Token Treasury:", curveTokenTreasury.toBase58());
  const mintInst5 = getMintToInstruction({
    mint: address(mint.toString()),
    token: address(curveTokenTreasury.toString()),
    mintAuthority: authority,
    amount: 400_000_000n * (10n ** 9n)
  });

  const instructions = [mintInst1, mintInst2, mintInst3, mintInst4, mintInst5];
  const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();

  const transactionMessage = pipe(
    createTransactionMessage({ version: 0 }),
    (tx) => setTransactionMessageFeePayerSigner(authority, tx),
    (tx) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, tx),
    (tx) => appendTransactionMessageInstructions(instructions, tx)
  );

  const signedTransaction =
    await signTransactionMessageWithSigners(transactionMessage);
  
  // Send and confirm transaction
  try {
      await sendAndConfirmTransactionFactory({ rpc, rpcSubscriptions })(
      signedTransaction as any,
      { commitment: "confirmed", skipPreflight: true }
      );
  } catch (error) {
      console.error("Transaction failed:", error);
      throw error;
  }

  // Get transaction signature
  const transactionSignature = getSignatureFromTransaction(signedTransaction);
  console.log("Transaction Signature:", transactionSignature);
}

// main();
// getTokenAccounts();
getInitAccountsAndMint();