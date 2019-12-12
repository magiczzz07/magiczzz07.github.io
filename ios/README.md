Code for newterm !

    git clone url ( clone your github)
	git status  ( looking changing file)
	git remote add origin https://github.com/yourusername/your-repo-name.git   ( get remote to your origin git)
	git init  ( looking the directory git hub on the phone)
	bzip2 + file name  ( compress file)
	bzip2 -d + file name ( decompress file)
	bzip2 -zk + filename  ( keepping default file and make copy file to conpress
	git push origin mater
    git add --all
    git commit -m "whatever"
    git push origin mater
	git pull origin mater ( take all change file to your git Phone)


Edit `Release` file. Modify the items pointed by `<--`

    Origin: NAME  <--
    Label: NAME  <--
    Suite: stable
    Version: 1.0
    Codename: ios
    Architectures: iphoneos-arm
    Components: main
    Description: CHANGED.....  <--

**Page Footers**

This data are the links that appear at the bottom of every depication. The data is stored in `repo.xml` at the root folder of your repo.

```xml
<repo>
    <footerlinks>
        <link>
            <name>Follow me on Twitter</name>
            <url>https://twitter.com/yourname</url>
            <iconclass>glyphicon glyphicon-user</iconclass>
        </link>
        <link>
            <name>I want this depiction template</name>
            <url>https://github.com/your name</url>
            <iconclass>glyphicon glyphicon-thumbs-up</iconclass>
        </link>
    </footerlinks>
</repo>
```


#### 3. Your repo is _almost_ ready.
At this point your repo is basically ready to be added into Cydia.
You can also visit your repo's homepage by going to `https://username.github.io/repo/`.
It will come with 2 sample packages, Old Package and New Package.
Each of the packages have a link on this page pointing to their depictions.
Next guide will show you how to assign and customize your depiction pages.

## Adding packages first package to your repo

```
<package>
    <id>hskmodmenu</id>
    <name>HSK Mod Menu v15</name>
    <version>1.0</version>
    <compatibility>
        <firmware>
            <miniOS>5.0</miniOS>
            <maxiOS>13.0</maxiOS>
            <otherVersions>unsupported</otherVersions>
            <!--
            for otherVersions, you can put either unsupported or unconfirmed
            -->
        </firmware>
    </compatibility>
    <dependencies></dependencies>
    <descriptionlist>
        <description>HSK Mod Menu</description>
    </descriptionlist>
    <screenshots>
	<screenshot>
			<description>This is a description for screenshot</description>
			<image>mod.jpg</image>
		</screenshot>	
	</screenshots>
    <changelog>
        <change>Initial release</change>
    </changelog>
    <links></links>
</package>

```
```
<changelog>
    <changes>
        <version>1.0</version>
        <change>Initial release</change>
    </changes>
</changelog>

```


#### 2. Link the depiction page your tweak's `control` file

You can add the depictions url at the end of your package's `control` file before compiling it.
The depiction line should look like this:

```text
Depiction: https://username.github.io/repo/depictions/?p=[idhere]
```

Replace `[idhere]` with your actual package name.

```text
Depiction: https://username.github.io/repo/depictions/?p=com.supermamon.oldpackage
```

#### 3. Rebuilding the `Packages` file

With your updated `control` file, build your tweak.
Store the resulting `.deb.` file into the `/debs/` folder of your repo.
Build your `Packages` file and compress with `bzip2`.

```sh
user:~/ $ cd repo
user:~/repo $ dpkg-scanpackages -m ./debs > Packages
user:~/repo $ bzip2 Packages
```


#### 5. Cydia at last!

If you haven't done yet, go ahead and add your repo to Cydia.
You should now be able to install your tweak into your own repo.

### Cleanup

Just a cleanup step, remove the debs that came with this template and re-run the commands on step 3. You can keep the sample depictions for reference by they're not needed for your repo.