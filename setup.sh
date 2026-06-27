#!/bin/sh
npx -y degit jittergitter05/KaisifOS temp_repo
cp -a temp_repo/. .
rm -rf temp_repo
