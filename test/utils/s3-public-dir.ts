import { randomBytes } from 'crypto';
import { promises as fs, createReadStream } from 'fs';
import * as path from 'path';

import { S3Client, CreateBucketCommand, PutBucketPolicyCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { lookup as lookupMimeType } from 'mime-types';

// Upload the content of the dirPath to the bucket
async function uploadDir(
  s3Client: S3Client,
  s3Path: string,
  bucketName: string,
  cacheControl?: string
) {
  async function getFiles(dir: string): Promise<string[]> {
    const dirents = await fs.readdir(dir, { withFileTypes: true });
    const files = await Promise.all(
      dirents.map((dirent) => {
        const res = path.resolve(dir, dirent.name);
        return dirent.isDirectory() ? getFiles(res) : res;
      })
    );
    return Array.prototype.concat(...files);
  }

  const files = (await getFiles(s3Path)) as string[];
  await Promise.all(
    files
      .filter((filePath) => !filePath.includes('.DS_Store'))
      .map((filePath) => {
        // Restore the relative structure
        const objectKey = path.relative(s3Path, filePath);
        const contentType = lookupMimeType(filePath);
        return s3Client.send(new PutObjectCommand({
          Key: objectKey,
          Bucket: bucketName,
          Body: createReadStream(filePath),
          CacheControl: cacheControl,
          ContentType: typeof contentType === 'string' ? contentType : undefined,
        }));
      })
  );

  return files;
}

/**
 * Creates a public bucket and uploads the content of dir to it
 * Returns the bucket name
 */
export async function s3PublicDir(
  s3Client: S3Client,
  dirPath: string,
  cacheControl?: string
): Promise<{ bucketName: string; files: string[] }> {
  const bucketName = randomBytes(8).toString('hex');

  // Configure the bucket so that the objects can be accessed publicly
  const bucketPolicy = {
    Bucket: bucketName,
    Policy: `{
      "Version": "2012-10-17",
      "Statement": [
        {
          "Action": [
            "s3:GetBucketLocation",
            "s3:ListBucket"
          ],
          "Effect": "Allow",
          "Principal": {
            "AWS": [
              "*"
            ]
          },
          "Resource": [
            "arn:aws:s3:::${bucketName}"
          ],
          "Sid": ""
        },
        {
          "Sid": "",
          "Effect": "Allow",
          "Principal": {
            "AWS": "*"
          },
          "Action": [
            "s3:GetObject"
          ],
          "Resource": [
            "arn:aws:s3:::${bucketName}/*"
          ]
        }
      ]
    }`,
  };

  await s3Client.send(new CreateBucketCommand({
    Bucket: bucketName,
    ACL: 'public-read',
  }));
  await s3Client.send(new PutBucketPolicyCommand(bucketPolicy));

  const files = await uploadDir(s3Client, dirPath, bucketName, cacheControl);

  return { bucketName, files };
}
